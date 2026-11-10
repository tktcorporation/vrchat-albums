import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import * as datefns from 'date-fns';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { Cause, Effect, Exit } from 'effect';
import path from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readTableDefinitions,
  reconcileLegacySchema,
  type TableDefinition,
} from './legacyTakeover';
import { applyMigrations } from './migrate';
import { loadEmbeddedMigrations } from './migrations';
import { vrchatPhotoPaths } from './schema';

/** アプリのバージョン 0.31.6 が作った DB（行を含む）。既存の DB の基準 */
const SEQUELIZE_FIXTURE = readFileSync(
  path.join(import.meta.dirname, '__fixtures__', 'sequelize-v0.31.6.sql'),
  'utf8',
);

let workDir: string;
let openDatabases: DatabaseSync[];

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'vrchat-albums-migrate-'));
  openDatabases = [];
});

afterEach(() => {
  vi.useRealTimers();
  for (const sqlite of openDatabases) {
    if (sqlite.isOpen) {
      sqlite.close();
    }
  }
  rmSync(workDir, { recursive: true, force: true });
});

const openFileDatabase = (setupSql?: string) => {
  const dbPath = path.join(workDir, 'db.sqlite');
  const sqlite = new DatabaseSync(dbPath);
  openDatabases.push(sqlite);
  sqlite.exec('PRAGMA journal_mode=WAL');
  if (setupSql !== undefined) {
    sqlite.exec(setupSql);
  }
  return { sqlite, db: drizzle({ client: sqlite }), dbPath };
};

/** マイグレーションを適用し、失敗したらそのエラーで reject する */
const migrate = async (target: ReturnType<typeof openFileDatabase>) => {
  const exit = await Effect.runPromiseExit(applyMigrations(target));
  if (Exit.isFailure(exit)) {
    throw Cause.squash(exit.cause);
  }
};

/** 型名の大文字小文字のように、SQLite の扱いが変わらない書き方の違いを揃えて比べる */
const normalize = (tables: TableDefinition[]) =>
  tables
    .filter((table) => table.name !== '__drizzle_migrations')
    .map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => ({
        ...column,
        type: column.type.toUpperCase(),
      })),
      indexes: table.indexes
        .map(({ name, unique, columns }) => ({ name, unique, columns }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

const sqliteMaster = (sqlite: DatabaseSync) =>
  sqlite
    .prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')
    .all();

const appliedMigrationNames = (sqlite: DatabaseSync) =>
  sqlite
    .prepare('SELECT name FROM __drizzle_migrations ORDER BY id')
    .all()
    .map((row) => row.name);

const backups = () => {
  const dir = path.join(workDir, 'backups');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .toSorted();
};

const openBackup = (name: string) => {
  const backup = new DatabaseSync(path.join(workDir, 'backups', name));
  openDatabases.push(backup);
  return backup;
};

/** 引き継げない食い違い（leaveDateTime の型が違う）を作る */
const MAKE_IRRECONCILABLE = `
  DROP TABLE VRChatPlayerLeaveLogModels;
  CREATE TABLE VRChatPlayerLeaveLogModels (id TEXT PRIMARY KEY, leaveDateTime INTEGER NOT NULL, playerName TEXT NOT NULL, playerId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
`;

describe('applyMigrations', () => {
  it('空の DB に、Sequelize が作っていたものと同じテーブル定義を作る', async () => {
    const fresh = openFileDatabase();
    await migrate(fresh);

    const legacy = new DatabaseSync(':memory:');
    openDatabases.push(legacy);
    legacy.exec(SEQUELIZE_FIXTURE);

    expect(normalize(readTableDefinitions(fresh.sqlite))).toEqual(
      normalize(readTableDefinitions(legacy)).filter(
        // Sequelize の記録用テーブルはアプリのテーブルではないので作らない
        (table) => table.name !== 'Migrations',
      ),
    );
    expect(appliedMigrationNames(fresh.sqlite)).toHaveLength(1);
  });

  it('Sequelize が作った DB を複製してから、定義を変えずに引き継ぐ', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    const before = sqliteMaster(target.sqlite);

    await migrate(target);

    // 定義は __drizzle_migrations が増えただけで、Sequelize の Migrations も残る
    const after = sqliteMaster(target.sqlite).filter(
      (row) => row.name !== '__drizzle_migrations',
    );
    expect(after).toEqual(before);
    expect(appliedMigrationNames(target.sqlite)).toHaveLength(1);

    // 行はそのまま読め、日時は Date に戻る
    const photos = target.db.select().from(vrchatPhotoPaths).all();
    expect(photos).toHaveLength(1);
    expect(photos[0]?.photoTakenAt.toISOString()).toBe(
      '2024-01-31T23:30:15.123Z',
    );

    // 複製には引き継ぐ前の行がある
    const [backupName] = backups();
    expect(backupName).toMatch(/^db-before-drizzle-\d{8}T\d{9}\.sqlite$/);
    const backup = openBackup(backupName);
    expect(
      backup.prepare('SELECT count(*) AS n FROM VRChatPhotoPathModels').get(),
    ).toEqual({ n: 1 });
    expect(
      backup
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('古い DB に足りないテーブル・列・インデックスを足して引き継ぐ', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      DROP TABLE VRChatPhotoMetadataModels;
      DROP INDEX \`world-joinDateTime-idx\`;
      ALTER TABLE VRChatPlayerLeaveLogModels DROP COLUMN playerId;
      ALTER TABLE VRChatPhotoPathModels DROP COLUMN width;
    `);

    await migrate(target);

    const fresh = new DatabaseSync(':memory:');
    openDatabases.push(fresh);
    fresh.exec(SEQUELIZE_FIXTURE);
    const tables = normalize(readTableDefinitions(target.sqlite));
    const leaveLog = tables.find(
      (t) => t.name === 'VRChatPlayerLeaveLogModels',
    );
    expect(leaveLog?.columns.map((c) => c.name)).toContain('playerId');
    const photoPath = tables.find((t) => t.name === 'VRChatPhotoPathModels');
    expect(photoPath?.columns.find((c) => c.name === 'width')).toMatchObject({
      notnull: 1,
      dflt_value: '1280',
    });
    expect(
      tables
        .find((t) => t.name === 'VRChatWorldJoinLogModels')
        ?.indexes.map((i) => i.name),
    ).toContain('world-joinDateTime-idx');
    expect(tables.map((t) => t.name)).toContain('VRChatPhotoMetadataModels');

    // 足した列の既定値が既存の行に入る
    expect(
      target.sqlite.prepare('SELECT width FROM VRChatPhotoPathModels').get(),
    ).toEqual({ width: 1280 });
    expect(appliedMigrationNames(target.sqlite)).toHaveLength(1);
  });

  it('名前が違っても同じ列のインデックスがあれば足さない', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      DROP INDEX v_r_chat_photo_path_models_photo_path_unique;
      CREATE UNIQUE INDEX v_r_chat_photo_path_models_photo_path ON VRChatPhotoPathModels (photoPath);
    `);

    await migrate(target);

    const indexes = target.sqlite
      .prepare("PRAGMA index_list('VRChatPhotoPathModels')")
      .all()
      .map((row) => row.name);
    expect(indexes).toContain('v_r_chat_photo_path_models_photo_path');
    expect(indexes).not.toContain(
      'v_r_chat_photo_path_models_photo_path_unique',
    );
  });

  it('自動では直せない食い違いがあれば、DB に触らずに失敗する', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      ALTER TABLE VRChatPlayerJoinLogModels ADD COLUMN legacyFlag TEXT NOT NULL DEFAULT 'x';
      DROP TABLE VRChatPlayerLeaveLogModels;
      CREATE TABLE VRChatPlayerLeaveLogModels (id TEXT PRIMARY KEY, leaveDateTime INTEGER NOT NULL, playerName TEXT NOT NULL, playerId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, extra TEXT NOT NULL);
    `);
    const before = sqliteMaster(target.sqlite);

    await expect(migrate(target)).rejects.toMatchObject({
      _tag: 'LegacyTakeoverIncomplete',
      backupPath: expect.stringContaining('db-before-drizzle-'),
      reason: {
        _tag: 'LegacySchemaIrreconcilable',
        issues: [
          {
            kind: 'COLUMN_TYPE_MISMATCH',
            table: 'VRChatPlayerLeaveLogModels',
            column: 'leaveDateTime',
          },
          {
            kind: 'EXTRA_NOT_NULL_COLUMN',
            table: 'VRChatPlayerLeaveLogModels',
            column: 'extra',
          },
        ],
      },
    });
    expect(sqliteMaster(target.sqlite)).toEqual(before);
  });

  it('補修の途中で失敗したら巻き戻し、DB を元のままにする', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    // 一意インデックスを足せないよう、同じ photoPath の行を入れておく
    target.sqlite.exec(`
      DROP INDEX v_r_chat_photo_path_models_photo_path_unique;
      INSERT INTO VRChatPhotoPathModels (id, photoPath, photoTakenAt, height, width, createdAt, updatedAt)
        VALUES ('dup', '/p/a.png', '2024-01-31 23:30:15.123 +00:00', 1, 1, '2024-01-31 23:30:15.123 +00:00', '2024-01-31 23:30:15.123 +00:00');
      DROP INDEX \`world-joinDateTime-idx\`;
    `);
    const before = sqliteMaster(target.sqlite);

    await expect(migrate(target)).rejects.toMatchObject({
      _tag: 'LegacyTakeoverIncomplete',
      reason: { _tag: 'LegacyTakeoverFailed' },
    });
    expect(sqliteMaster(target.sqlite)).toEqual(before);
  });

  it('補修の途中でディスクが足りなくなったら、開いたままのトランザクションを巻き戻し、その理由のまま失敗する', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    // 空きページを詰めてから上限を今の大きさに固定し、インデックスを足す書き込みを SQLITE_FULL にする。
    // このとき SQLite は失敗した文だけを巻き戻し、トランザクションは開いたまま残る
    target.sqlite.exec(`
      DROP INDEX \`world-joinDateTime-idx\`;
      VACUUM;
    `);
    const pageCount = Number(
      target.sqlite.prepare('PRAGMA page_count').get()?.page_count,
    );
    target.sqlite.exec(`PRAGMA max_page_count=${pageCount}`);
    const before = sqliteMaster(target.sqlite);

    await expect(migrate(target)).rejects.toMatchObject({
      _tag: 'LegacyTakeoverIncomplete',
      reason: {
        _tag: 'LegacyTakeoverFailed',
        message: expect.stringContaining('database or disk is full'),
      },
    });
    expect(target.sqlite.isTransaction).toBe(false);
    expect(sqliteMaster(target.sqlite)).toEqual(before);
  });

  it('SQLite がトランザクションを巻き戻し済みでも、元の失敗を返す', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec('DROP INDEX `world-joinDateTime-idx`');
    const before = sqliteMaster(target.sqlite);
    // SQLITE_IOERR などで SQLite がトランザクションごと巻き戻した状態を作る
    const markBaselineApplied = () => {
      target.sqlite.exec('ROLLBACK');
      throw new Error('disk I/O error');
    };

    const exit = await Effect.runPromiseExit(
      reconcileLegacySchema({
        sqlite: target.sqlite,
        baselineStatements: loadEmbeddedMigrations()[0]?.sql ?? [],
        markBaselineApplied,
      }),
    );

    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: 'LegacyTakeoverFailed',
      message: expect.stringContaining('disk I/O error'),
    });
    expect(sqliteMaster(target.sqlite)).toEqual(before);
  });

  it('2 回目以降は何もしない', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    await migrate(target);
    const masterAfterFirst = sqliteMaster(target.sqlite);
    const migrationsAfterFirst = appliedMigrationNames(target.sqlite);

    await migrate(target);

    expect(sqliteMaster(target.sqlite)).toEqual(masterAfterFirst);
    expect(appliedMigrationNames(target.sqlite)).toEqual(migrationsAfterFirst);
    expect(backups()).toHaveLength(1);
  });

  it('複製には WAL にだけある行も入る', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    // 自動のチェックポイントを止め、足した行を WAL にだけ置く
    target.sqlite.exec(`
      PRAGMA wal_autocheckpoint=0;
      INSERT INTO VRChatPhotoPathModels (id, photoPath, photoTakenAt, height, width, createdAt, updatedAt)
        VALUES ('wal-only', '/p/wal.png', '2024-02-01 00:00:00.000 +00:00', 1, 1, '2024-02-01 00:00:00.000 +00:00', '2024-02-01 00:00:00.000 +00:00');
    `);

    await migrate(target);

    const [backupName] = backups();
    expect(
      openBackup(backupName)
        .prepare(
          'SELECT photoPath FROM VRChatPhotoPathModels ORDER BY photoPath',
        )
        .all()
        .map((row) => row.photoPath),
    ).toEqual(['/p/a.png', '/p/wal.png']);
  });

  it('引き継ぎを終えるまで試すたびに新しい複製を作り、新しい 3 つだけを残す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(MAKE_IRRECONCILABLE);

    const attempts = [
      '2026-01-01T00:00:00.001Z',
      '2026-01-01T00:00:00.002Z',
      '2026-01-01T00:00:01.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ];
    for (const [i, at] of attempts.entries()) {
      vi.setSystemTime(new Date(at));
      // 前の試行の後に書かれた行が、次の複製に入ることを確かめるため
      target.sqlite.exec(
        `INSERT INTO VRChatPlayerJoinLogModels (id, playerId, playerName, joinDateTime, createdAt, updatedAt)
           VALUES ('attempt-${i}', NULL, 'P${i}', '2024-02-0${i + 1} 00:00:00.000 +00:00', 'x', 'x')`,
      );
      await expect(migrate(target)).rejects.toMatchObject({
        _tag: 'LegacyTakeoverIncomplete',
      });
    }

    // 古い 2 つを消し、新しい 3 つを残す
    expect(backups()).toEqual(
      attempts
        .slice(-3)
        .map(
          (at) =>
            `db-before-drizzle-${datefns.format(new Date(at), "yyyyMMdd'T'HHmmssSSS")}.sqlite`,
        ),
    );
    // 最後の複製には、最後の試行の直前に書いた行まで入っている
    expect(
      openBackup(backups().at(-1) ?? '')
        .prepare('SELECT count(*) AS n FROM VRChatPlayerJoinLogModels')
        .get(),
    ).toEqual({ n: 1 + attempts.length });
  });

  it('NOT NULL のはずの列が NULL 可でも、NULL の行が無ければ引き継ぐ', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      CREATE TABLE leave_copy AS SELECT * FROM VRChatPlayerLeaveLogModels;
      DROP TABLE VRChatPlayerLeaveLogModels;
      CREATE TABLE VRChatPlayerLeaveLogModels (id TEXT PRIMARY KEY, leaveDateTime TEXT, playerName TEXT NOT NULL, playerId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      INSERT INTO VRChatPlayerLeaveLogModels SELECT * FROM leave_copy;
      DROP TABLE leave_copy;
    `);

    await migrate(target);

    expect(appliedMigrationNames(target.sqlite)).toHaveLength(1);
  });

  it('NOT NULL のはずの列に NULL の行があれば、引き継げない食い違いとして止める', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      DROP TABLE VRChatPlayerLeaveLogModels;
      CREATE TABLE VRChatPlayerLeaveLogModels (id TEXT PRIMARY KEY, leaveDateTime TEXT, playerName TEXT NOT NULL, playerId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      INSERT INTO VRChatPlayerLeaveLogModels VALUES ('null-row', NULL, 'Alice', NULL, 'x', 'x');
    `);
    const before = sqliteMaster(target.sqlite);

    await expect(migrate(target)).rejects.toMatchObject({
      _tag: 'LegacyTakeoverIncomplete',
      reason: {
        _tag: 'LegacySchemaIrreconcilable',
        issues: [
          {
            kind: 'NULL_IN_NOT_NULL_COLUMN',
            table: 'VRChatPlayerLeaveLogModels',
            column: 'leaveDateTime',
          },
        ],
      },
    });
    expect(sqliteMaster(target.sqlite)).toEqual(before);
  });

  it('知らない一意インデックスは、衝突先を指定する更新が無いテーブルなら引き継ぐ', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(
      'CREATE UNIQUE INDEX legacy_world_name ON VRChatWorldJoinLogModels (worldName, joinDateTime)',
    );

    await migrate(target);

    expect(appliedMigrationNames(target.sqlite)).toHaveLength(1);
  });

  it('衝突先を指定して更新するテーブルに知らない一意インデックスがあれば止める', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(
      'CREATE UNIQUE INDEX legacy_photo_taken_at ON VRChatPhotoPathModels (photoTakenAt)',
    );

    await expect(migrate(target)).rejects.toMatchObject({
      _tag: 'LegacyTakeoverIncomplete',
      reason: {
        _tag: 'LegacySchemaIrreconcilable',
        issues: [
          {
            kind: 'EXTRA_UNIQUE_INDEX_ON_UPSERT_TABLE',
            table: 'VRChatPhotoPathModels',
            index: 'legacy_photo_taken_at',
          },
        ],
      },
    });
  });
});
