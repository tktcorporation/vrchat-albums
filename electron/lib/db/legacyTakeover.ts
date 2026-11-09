import { promises as fs } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import * as datefns from 'date-fns';
import { getTableName } from 'drizzle-orm';
import { Effect } from 'effect';
import path from 'pathe';
import { z } from 'zod';

import { logger } from '../logger';
import {
  type IrreconcilableSchemaIssue,
  LegacyBackupFailed,
  LegacySchemaIrreconcilable,
  LegacyTakeoverFailed,
} from './errors';
import { vrchatPhotoMetadata, vrchatPhotoPaths } from './schema';

/**
 * Sequelize が作った DB を、Drizzle のマイグレーションの管理下へ引き継ぐ。
 *
 * Sequelize の時代の DB には `__drizzle_migrations` が無く、テーブルは起動時の
 * `sync({ alter: true })` で作られていた。利用者が飛ばしたアプリのバージョンによっては、
 * テーブル定義が基準のマイグレーション（最初のマイグレーション）と食い違う。そこで次の順に進める。
 *
 * 1. DB を複製して残す（`backupLegacyDatabase`）。引き継ぎを終えるまで、試すたびに新しい複製を作る
 * 2. 基準のマイグレーションと実際の定義を比べ、足りないテーブル・列・インデックスを足す
 * 3. 基準のマイグレーションを「適用済み」として記録する
 *
 * 2 と 3 は 1 つのトランザクションで行い、どこかで失敗したら DB を元に戻す。
 * 自動では直せない食い違い（`IrreconcilableSchemaIssue`）があれば、DB に触らずに止める。
 * Sequelize が使っていた `Migrations` テーブルは消さずに残す。
 */

const TableInfoRowSchema = z.object({
  name: z.string(),
  type: z.string(),
  notnull: z.number(),
  dflt_value: z.string().nullable(),
  pk: z.number(),
});
type TableInfoRow = z.infer<typeof TableInfoRowSchema>;

const IndexListRowSchema = z.object({
  name: z.string(),
  unique: z.number(),
  origin: z.string(),
});

const IndexInfoRowSchema = z.object({ name: z.string().nullable() });

const SqliteMasterRowSchema = z.object({
  type: z.string(),
  name: z.string(),
  tbl_name: z.string(),
  sql: z.string().nullable(),
});

interface IndexDefinition {
  name: string;
  unique: boolean;
  columns: string[];
  /** `CREATE INDEX` の文。基準の DB から取るときだけ持つ */
  createSql: string | null;
}

export interface TableDefinition {
  name: string;
  createSql: string;
  columns: TableInfoRow[];
  indexes: IndexDefinition[];
}

const quoteIdentifier = (name: string): string =>
  `"${name.replaceAll('"', '""')}"`;

const readRows = <T>(
  sqlite: DatabaseSync,
  schema: z.ZodType<T>,
  query: string,
): T[] => z.array(schema).parse(sqlite.prepare(query).all());

/** `sqlite_` で始まる内部テーブルと Drizzle の記録用テーブルを除いた、テーブルの名前 */
export const listUserTables = (sqlite: DatabaseSync): string[] =>
  readRows(
    sqlite,
    SqliteMasterRowSchema,
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type = 'table'",
  )
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'));

const readIndexes = (
  sqlite: DatabaseSync,
  table: string,
  createSqlByName: Map<string, string | null>,
): IndexDefinition[] =>
  readRows(
    sqlite,
    IndexListRowSchema,
    `PRAGMA index_list(${quoteIdentifier(table)})`,
  )
    // 主キーが自動で作るインデックスは、列の定義の比較で扱う
    .filter((row) => row.origin !== 'pk')
    .map((row) => ({
      name: row.name,
      unique: row.unique === 1,
      columns: readRows(
        sqlite,
        IndexInfoRowSchema,
        `PRAGMA index_info(${quoteIdentifier(row.name)})`,
      ).map((column) => column.name ?? ''),
      createSql: createSqlByName.get(row.name) ?? null,
    }));

/** DB のテーブル定義を、列とインデックスまで読む */
export const readTableDefinitions = (
  sqlite: DatabaseSync,
): TableDefinition[] => {
  const masterRows = readRows(
    sqlite,
    SqliteMasterRowSchema,
    'SELECT type, name, tbl_name, sql FROM sqlite_master',
  );
  const indexSqlByName = new Map(
    masterRows
      .filter((row) => row.type === 'index')
      .map((row) => [row.name, row.sql]),
  );
  return masterRows
    .filter((row) => row.type === 'table' && !row.name.startsWith('sqlite_'))
    .map((row) => ({
      name: row.name,
      createSql: row.sql ?? '',
      columns: readRows(
        sqlite,
        TableInfoRowSchema,
        `PRAGMA table_info(${quoteIdentifier(row.name)})`,
      ),
      indexes: readIndexes(sqlite, row.name, indexSqlByName),
    }));
};

/**
 * 基準のマイグレーションをメモリ上の空の DB に適用し、そのテーブル定義を返す。
 * 期待する定義をマイグレーションの SQL から作るので、定義を別の場所に書き写さずに済む。
 */
const readBaselineDefinitions = (
  baselineStatements: readonly string[],
): TableDefinition[] => {
  const reference = new DatabaseSync(':memory:');
  for (const statement of baselineStatements) {
    if (statement.trim() !== '') {
      reference.exec(statement);
    }
  }
  const definitions = readTableDefinitions(reference);
  reference.close();
  return definitions;
};

/**
 * 宣言された型から SQLite の型の親和性を求める（SQLite のドキュメント "Datatypes In SQLite" の
 * 3.1 節の規則）。`VARCHAR(255)` と `TEXT` のように、書き方が違っても値の扱いが同じ型を同じとみなすため。
 */
const typeAffinity = (declaredType: string): string => {
  const upper = declaredType.toUpperCase();
  if (upper.includes('INT')) {
    return 'INTEGER';
  }
  if (
    upper.includes('CHAR') ||
    upper.includes('CLOB') ||
    upper.includes('TEXT')
  ) {
    return 'TEXT';
  }
  if (upper === '' || upper.includes('BLOB')) {
    return 'BLOB';
  }
  if (
    upper.includes('REAL') ||
    upper.includes('FLOA') ||
    upper.includes('DOUB')
  ) {
    return 'REAL';
  }
  return 'NUMERIC';
};

/**
 * 既存の列の型を、期待する列の型として受け入れてよいか。
 *
 * 型の親和性が同じなら受け入れる。加えて、日時の列を `DATETIME` で宣言した古い DB も受け入れる。
 * 親和性は NUMERIC になるが、日時は `YYYY-MM-DD HH:MM:SS.SSS +00:00` の文字列で書かれ、
 * 数値に見えない文字列は NUMERIC の列でも文字列のまま保存されるので、読み書きと比較の結果が変わらない。
 */
const isCompatibleColumnType = (expected: string, actual: string): boolean => {
  const expectedAffinity = typeAffinity(expected);
  const actualAffinity = typeAffinity(actual);
  if (expectedAffinity === actualAffinity) {
    return true;
  }
  return (
    expectedAffinity === 'TEXT' &&
    /DATE|TIME/i.test(actual) &&
    actualAffinity === 'NUMERIC'
  );
};

const indexSignature = (index: IndexDefinition): string =>
  `${index.unique ? 'unique' : 'plain'}:${index.columns.join(',')}`;

/** 既存の DB にある、基準のマイグレーションに無い一意インデックス */
interface ExtraUniqueIndex {
  table: string;
  index: string;
  columns: string[];
}

/** 既存の DB を基準の定義へ合わせるための計画 */
interface ReconcilePlan {
  /** 足りないものを足す文。上から順に実行する */
  statements: string[];
  /** 自動では直せない食い違い。1 つでもあれば DB に触らずに止める */
  issues: IrreconcilableSchemaIssue[];
  /** 基準に無い一意インデックス。食い違いにならないものも、調査のために記録へ残す */
  extraUniqueIndexes: ExtraUniqueIndex[];
}

/**
 * 衝突先を指定して更新する INSERT（`onConflictDoUpdate`）を使うテーブル。
 * SQLite の ON CONFLICT は指定した衝突先にしか効かないので、これらのテーブルに別の一意インデックスが
 * あると、そのインデックスに当たった行で INSERT 全体が失敗する。他のテーブルの INSERT は衝突先を
 * 指定しない ON CONFLICT DO NOTHING なので、どの一意インデックスに当たっても行を飛ばすだけで済む。
 *
 * @see electron/module/vrchatPhoto/model/vrchatPhotoPath.model.ts - createOrUpdateListVRChatPhotoPath
 * @see electron/module/vrchatPhotoMetadata/vrchatPhotoMetadata.model.ts - createOrUpdatePhotoMetadataBatch
 */
const TABLES_WITH_TARGETED_UPSERT: ReadonlySet<string> = new Set([
  getTableName(vrchatPhotoPaths),
  getTableName(vrchatPhotoMetadata),
]);

/** 列に NULL の行が 1 つでもあるか */
type HasNullRows = (table: string, column: string) => boolean;

const addColumnStatement = (table: string, column: TableInfoRow): string =>
  [
    `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column.name)} ${column.type}`,
    column.dflt_value === null ? '' : ` DEFAULT ${column.dflt_value}`,
    column.notnull === 1 ? ' NOT NULL' : '',
  ].join('');

const planColumns = (
  expected: TableDefinition,
  actual: TableDefinition,
  hasNullRows: HasNullRows,
): ReconcilePlan => {
  const plan: ReconcilePlan = {
    statements: [],
    issues: [],
    extraUniqueIndexes: [],
  };
  const actualByName = new Map(actual.columns.map((c) => [c.name, c]));
  const expectedNames = new Set(expected.columns.map((c) => c.name));

  for (const column of expected.columns) {
    const existing = actualByName.get(column.name);
    if (existing === undefined) {
      if (column.pk > 0) {
        plan.issues.push({
          kind: 'PRIMARY_KEY_MISMATCH',
          table: expected.name,
          column: column.name,
        });
      } else if (column.notnull === 1 && column.dflt_value === null) {
        plan.issues.push({
          kind: 'MISSING_NOT_NULL_COLUMN',
          table: expected.name,
          column: column.name,
        });
      } else {
        plan.statements.push(addColumnStatement(expected.name, column));
      }
      continue;
    }
    if (!isCompatibleColumnType(column.type, existing.type)) {
      plan.issues.push({
        kind: 'COLUMN_TYPE_MISMATCH',
        table: expected.name,
        column: column.name,
        expected: column.type,
        actual: existing.type,
      });
    }
    if (column.pk > 0 !== existing.pk > 0) {
      plan.issues.push({
        kind: 'PRIMARY_KEY_MISMATCH',
        table: expected.name,
        column: column.name,
      });
    }
    // 期待は NULL 可で既存が NOT NULL なら、アプリが NULL を書くと失敗するので止める
    if (column.notnull === 0 && existing.notnull === 1 && column.pk === 0) {
      plan.issues.push({
        kind: 'UNEXPECTED_NOT_NULL',
        table: expected.name,
        column: column.name,
      });
    }
    // 期待は NOT NULL で既存が NULL 可なら、アプリが必ず値を書くので書き込みは失敗しない。
    // ただし NULL の行が既にあると、読んだときに日時や文字列のはずの値が null になるので止める
    if (
      column.notnull === 1 &&
      existing.notnull === 0 &&
      column.pk === 0 &&
      hasNullRows(expected.name, column.name)
    ) {
      plan.issues.push({
        kind: 'NULL_IN_NOT_NULL_COLUMN',
        table: expected.name,
        column: column.name,
      });
    }
  }

  for (const column of actual.columns) {
    if (
      !expectedNames.has(column.name) &&
      column.notnull === 1 &&
      column.dflt_value === null
    ) {
      plan.issues.push({
        kind: 'EXTRA_NOT_NULL_COLUMN',
        table: expected.name,
        column: column.name,
      });
    }
  }
  return plan;
};

const planIndexes = (
  expected: TableDefinition,
  actual: TableDefinition,
): ReconcilePlan => {
  const plan: ReconcilePlan = {
    statements: [],
    issues: [],
    extraUniqueIndexes: [],
  };
  // 名前が違っても、同じ列・同じ一意性のインデックスがあれば足さない。Sequelize のバージョンによって
  // インデックスの名前の付け方が違うため
  const actualSignatures = new Set(actual.indexes.map(indexSignature));
  const actualByName = new Map(actual.indexes.map((i) => [i.name, i]));
  const expectedSignatures = new Set(expected.indexes.map(indexSignature));
  const expectedNames = new Set(expected.indexes.map((i) => i.name));

  // 同じ名前で定義が違うものは INDEX_DEFINITION_CONFLICT として下で扱う
  for (const index of actual.indexes) {
    if (
      index.unique &&
      !expectedSignatures.has(indexSignature(index)) &&
      !expectedNames.has(index.name)
    ) {
      plan.extraUniqueIndexes.push({
        table: expected.name,
        index: index.name,
        columns: index.columns,
      });
      if (TABLES_WITH_TARGETED_UPSERT.has(expected.name)) {
        plan.issues.push({
          kind: 'EXTRA_UNIQUE_INDEX_ON_UPSERT_TABLE',
          table: expected.name,
          index: index.name,
        });
      }
    }
  }

  for (const index of expected.indexes) {
    if (actualSignatures.has(indexSignature(index))) {
      continue;
    }
    if (actualByName.has(index.name)) {
      plan.issues.push({
        kind: 'INDEX_DEFINITION_CONFLICT',
        table: expected.name,
        index: index.name,
      });
      continue;
    }
    if (index.createSql !== null) {
      plan.statements.push(index.createSql);
    }
  }
  return plan;
};

/**
 * 既存の DB の定義と基準の定義を比べ、足りないものを足す文と、直せない食い違いを返す。
 * 基準に無いテーブル（Sequelize の `Migrations` など）には触らない。
 */
const planReconcile = (
  expectedTables: readonly TableDefinition[],
  actualTables: readonly TableDefinition[],
  hasNullRows: HasNullRows,
): ReconcilePlan => {
  const actualByName = new Map(actualTables.map((t) => [t.name, t]));
  const plans = expectedTables.map((expected): ReconcilePlan => {
    const actual = actualByName.get(expected.name);
    if (actual === undefined) {
      return {
        statements: [
          expected.createSql,
          ...expected.indexes.flatMap((index) =>
            index.createSql === null ? [] : [index.createSql],
          ),
        ],
        issues: [],
        extraUniqueIndexes: [],
      };
    }
    const columns = planColumns(expected, actual, hasNullRows);
    const indexes = planIndexes(expected, actual);
    return {
      statements: [...columns.statements, ...indexes.statements],
      issues: [...columns.issues, ...indexes.issues],
      extraUniqueIndexes: indexes.extraUniqueIndexes,
    };
  });
  return {
    statements: plans.flatMap((p) => p.statements),
    issues: plans.flatMap((p) => p.issues),
    extraUniqueIndexes: plans.flatMap((p) => p.extraUniqueIndexes),
  };
};

/** 引き継ぎの前の複製と、作り直すときに退避した DB を置くディレクトリ。DB の横の `backups` */
export const legacyBackupDir = (dbPath: string): string =>
  path.join(path.dirname(dbPath), 'backups');

/** 引き継ぎの前の複製を置くディレクトリでの、ファイル名の接頭辞 */
const LEGACY_BACKUP_PREFIX = 'db-before-drizzle-';

/**
 * 残しておく引き継ぎの前の複製の数。引き継ぎを終えられない DB は起動のたびに複製を作るので、
 * 古いものから消してディスクを使い切らないようにする。新しいものほど直前の DB に近いので、新しい方を残す
 */
const MAX_LEGACY_BACKUPS = 3;

/** 名前で並べると古い順になる日時の書式。同じ秒に 2 回試しても名前がぶつからないようミリ秒まで書く */
const BACKUP_TIMESTAMP_FORMAT = "yyyyMMdd'T'HHmmssSSS";

/** 引き継ぎの前の複製のうち、新しい `MAX_LEGACY_BACKUPS` 個を残して消す */
const pruneLegacyBackups = (backupDir: string): Effect.Effect<void> =>
  Effect.tryPromise({
    try: async () => {
      const backups = (await fs.readdir(backupDir))
        .filter(
          (name) =>
            name.startsWith(LEGACY_BACKUP_PREFIX) && name.endsWith('.sqlite'),
        )
        .toSorted();
      for (const name of backups.slice(0, -MAX_LEGACY_BACKUPS)) {
        await fs.rm(path.join(backupDir, name), { force: true });
      }
    },
    catch: (cause) => cause,
  }).pipe(
    // 古い複製が残っても引き継ぎには差し支えないので、記録だけして進める
    Effect.catch((cause) =>
      Effect.sync(() => {
        logger.warn('Failed to remove old database backups', {
          backupDir,
          cause,
        });
      }),
    ),
  );

/**
 * 引き継ぎの前に DB を `<backupDir>/db-before-drizzle-<日時>.sqlite` へ複製する。
 *
 * `VACUUM INTO` で書き出すので、WAL にだけある行も含めた、ある時点の一貫した中身が 1 つのファイルに入る。
 * 引き継ぎを終えるまでは、試すたびに新しい複製を作る。前に作った複製は、その後に書かれた行を含まないため。
 * 複製は新しい `MAX_LEGACY_BACKUPS` 個だけを残す。
 *
 * @returns 作った複製のパス。メモリ上の DB は複製しないので null
 */
export const backupLegacyDatabase = (props: {
  sqlite: DatabaseSync;
  dbPath: string;
  backupDir: string;
  now: Date;
}): Effect.Effect<string | null, LegacyBackupFailed> => {
  if (props.dbPath === ':memory:') {
    return Effect.succeed(null);
  }
  const backupPath = path.join(
    props.backupDir,
    `${LEGACY_BACKUP_PREFIX}${datefns.format(props.now, BACKUP_TIMESTAMP_FORMAT)}.sqlite`,
  );
  return Effect.tryPromise({
    try: async () => {
      await fs.mkdir(props.backupDir, { recursive: true });
      props.sqlite.prepare('VACUUM INTO ?').run(backupPath);
      return backupPath;
    },
    catch: (cause) =>
      new LegacyBackupFailed({
        message: `Failed to back up the database before taking it over: ${backupPath}`,
        backupPath,
        cause,
      }),
  }).pipe(Effect.tap(() => pruneLegacyBackups(props.backupDir)));
};

/**
 * 計画を確かめ、足りないものを足してから `markBaselineApplied` で基準のマイグレーションを
 * 適用済みとして記録する。全部を 1 つのトランザクションで行う。
 */
export const reconcileLegacySchema = (props: {
  sqlite: DatabaseSync;
  baselineStatements: readonly string[];
  markBaselineApplied: () => void;
}): Effect.Effect<
  { applied: string[] },
  LegacySchemaIrreconcilable | LegacyTakeoverFailed
> =>
  Effect.gen(function* () {
    const plan = planReconcile(
      readBaselineDefinitions(props.baselineStatements),
      readTableDefinitions(props.sqlite),
      (table, column) =>
        props.sqlite
          .prepare(
            `SELECT 1 FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} IS NULL LIMIT 1`,
          )
          .get() !== undefined,
    );
    if (plan.extraUniqueIndexes.length > 0) {
      logger.warn(
        'The existing database has unique indexes that the app does not define',
        { extraUniqueIndexes: plan.extraUniqueIndexes },
      );
    }
    if (plan.issues.length > 0) {
      return yield* Effect.fail(
        new LegacySchemaIrreconcilable({
          message: `Existing database schema cannot be taken over automatically: ${plan.issues
            .map((issue) => `${issue.kind}(${issue.table})`)
            .join(', ')}`,
          issues: plan.issues,
        }),
      );
    }
    const toTakeoverFailed = (cause: unknown) =>
      new LegacyTakeoverFailed({
        message: `Failed to take over the existing database: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      });
    yield* Effect.try({
      try: () => props.sqlite.exec('BEGIN IMMEDIATE'),
      catch: toTakeoverFailed,
    });
    yield* Effect.try({
      try: () => {
        for (const statement of plan.statements) {
          props.sqlite.exec(statement);
        }
        props.markBaselineApplied();
        props.sqlite.exec('COMMIT');
      },
      catch: toTakeoverFailed,
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          props.sqlite.exec('ROLLBACK');
        }),
      ),
    );
    return { applied: plan.statements };
  });
