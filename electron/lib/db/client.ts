import { DatabaseSync } from 'node:sqlite';

import type { EmptyRelations } from 'drizzle-orm';
import {
  drizzle,
  type NodeSQLiteDatabase,
  type NodeSQLiteTransaction,
} from 'drizzle-orm/node-sqlite';
import { Cause, Effect, Exit } from 'effect';
import { match } from 'ts-pattern';

import { logger } from '../logger';
import {
  LegacyDatabaseNotRebuildable,
  LegacyDatabaseRebuildFailed,
  type LegacySchemaIrreconcilable,
  type LegacyTakeoverError,
  type LegacyTakeoverFailed,
  type LegacyTakeoverIncomplete,
} from './errors';
import { planLegacyRecovery, setAsideLegacyDatabase } from './legacyRecovery';
import { legacyBackupDir } from './legacyTakeover';
import { applyMigrations } from './migrate';
import { appTables, TABLE_REBUILD_SOURCES } from './schema';

/** アプリが使う Drizzle の DB。`node:sqlite` の同期ドライバの上に作る */
export type AppDatabase = NodeSQLiteDatabase;

/** `AppDatabase.transaction` のコールバックが受け取るトランザクション */
export type AppTransaction = NodeSQLiteTransaction<EmptyRelations>;

/**
 * クエリを発行できる相手。トランザクションの中でも外でも同じ関数を使えるよう、
 * モデルの書き込み関数はこれを受け取る。
 */
export type DBExecutor = AppDatabase | AppTransaction;

interface RDBClient {
  /** 開いた DB のファイルの場所（テストでは `:memory:`） */
  readonly path: string;
  /** 任意の SQL を実行するための生の接続。デバッグ用の SQL コンソールと既存 DB の引き継ぎだけが使う */
  readonly sqlite: DatabaseSync;
  readonly db: AppDatabase;
}

let rdbClient: RDBClient | null = null;

/**
 * SQLite の PRAGMA を設定する。
 * - journal_mode=WAL: 読み取りが書き込みを待たずに済む
 * - busy_timeout=5000: 別の接続がロックしているとき、失敗する前に最大 5 秒待つ
 * - synchronous=NORMAL: WAL モードでは安全。トランザクションごとの fsync を省き書き込みの I/O を減らす
 * - cache_size=-50000: ページキャッシュを 50MB にする（既定は約 2MB）。一括登録でのページの入れ替えを減らす
 * - temp_store=MEMORY: 並べ替えなどの一時領域をメモリに置く
 */
const configureSQLitePragmas = (sqlite: DatabaseSync): void => {
  sqlite.exec('PRAGMA journal_mode=WAL');
  sqlite.exec('PRAGMA busy_timeout=5000');
  sqlite.exec('PRAGMA synchronous=NORMAL');
  sqlite.exec('PRAGMA cache_size=-50000');
  sqlite.exec('PRAGMA temp_store=MEMORY');
};

const openRDBClient = (path: string): RDBClient => {
  if (rdbClient !== null) {
    throw new Error(`rdbClient is already initialized with ${rdbClient.path}`);
  }
  const sqlite = new DatabaseSync(path);
  configureSQLitePragmas(sqlite);
  rdbClient = { path, sqlite, db: drizzle({ client: sqlite }) };
  logger.info(
    'SQLite opened: journal_mode=WAL, busy_timeout=5000, synchronous=NORMAL, cache_size=50MB, temp_store=MEMORY',
  );
  return rdbClient;
};

/**
 * 処理本体の起動時に DB を開く。テーブルの作成と更新は `migrateRDBClient` が行う。
 *
 * `node:sqlite` はクエリを呼び出したスレッドで同期的に実行する。DB は処理本体（utilityProcess）
 * だけが開くので、止まるのは処理本体のイベントループで、画面と main プロセスは止まらない。
 */
export const initRDBClient = (props: { db_url: string }): void => {
  openRDBClient(props.db_url);
};

/**
 * 開いている DB を閉じる。開いていなければ何もしない。
 *
 * 実行中のクエリの終わりは待たない。処理本体の終了では、先に `drainDBQueues`（`../dbQueue`）で
 * キューの実行中のタスクを待ってから呼ぶ。
 */
export const closeRDBClient = (): void => {
  if (rdbClient === null) {
    return;
  }
  rdbClient.sqlite.close();
  rdbClient = null;
};

const getRDBClient = (): RDBClient => {
  if (rdbClient === null) {
    throw new Error('rdbClient is not initialized');
  }
  return rdbClient;
};

/** 開いている DB を返す。開いていなければ投げる */
export const getDB = (): AppDatabase => getRDBClient().db;

/**
 * Drizzle を通さない生の接続を返す。デバッグ用の SQL コンソールのように、利用者が書いた任意の
 * SQL をそのまま実行する場所だけで使う。
 */
export const getRawSQLite = (): DatabaseSync => getRDBClient().sqlite;

/** `migrateRDBClient` の結果 */
export type MigrateOutcome =
  | { kind: 'migrated' }
  | {
      /**
       * Sequelize の時代の DB を引き継げなかったので、退避して空の DB を作り直した。
       * 行はログの保存先と写真のフォルダからの全件の同期で作り直す必要がある
       */
      kind: 'rebuilt';
      /** 引き継ぐ前の DB の複製 */
      backupPath: string;
      /** 退避した DB 本体 */
      setAsidePath: string;
      reason: LegacySchemaIrreconcilable | LegacyTakeoverFailed;
    };

const applyMigrationsTo = (
  client: RDBClient,
): Effect.Effect<void, LegacyTakeoverError> =>
  applyMigrations({
    db: client.db,
    sqlite: client.sqlite,
    dbPath: client.path,
  });

/**
 * 引き継げなかった DB を退避し、同じ場所に空の DB を作ってマイグレーションを適用する。
 *
 * どのテーブルも DB の外から作り直せる（`TABLE_REBUILD_SOURCES`）ときだけ行う。作り直さないと、
 * 引き継ぎは起動のたびに同じところで失敗し続け、アプリを使えなくなる。行は呼び出し元が全件の
 * ログ同期で作り直す。作り直せないテーブルがあれば、DB に触らずに `LegacyDatabaseNotRebuildable` を返す。
 */
const rebuildUntakeableDatabase = (
  incomplete: LegacyTakeoverIncomplete,
): Effect.Effect<
  MigrateOutcome,
  LegacyDatabaseNotRebuildable | LegacyDatabaseRebuildFailed
> =>
  Effect.gen(function* () {
    const plan = planLegacyRecovery(TABLE_REBUILD_SOURCES);
    yield* match(plan)
      .with({ kind: 'rebuild' }, () => Effect.void)
      .with({ kind: 'stop' }, ({ nonDerivableTables }) =>
        Effect.fail(
          new LegacyDatabaseNotRebuildable({
            message: `The database cannot be rebuilt because these tables hold data that exists only in the database: ${nonDerivableTables.join(', ')}`,
            backupPath: incomplete.backupPath,
            nonDerivableTables,
            reason: incomplete.reason,
          }),
        ),
      )
      .exhaustive();

    const dbPath = getRDBClient().path;
    closeRDBClient();
    const setAsidePath = yield* setAsideLegacyDatabase({
      dbPath,
      backupDir: legacyBackupDir(dbPath),
      now: new Date(),
    }).pipe(
      // DB を元の場所から動かせなかったなら、元の DB を開き直して接続を起動前と同じ状態に戻す
      Effect.tapError((failed) =>
        Effect.sync(() => {
          if (!failed.movedMainFile) {
            openRDBClient(dbPath);
          }
        }),
      ),
      Effect.mapError(
        (failed) =>
          new LegacyDatabaseRebuildFailed({
            message: `Failed to move the database aside: ${dbPath}`,
            backupPath: incomplete.backupPath,
            cause: failed.cause,
          }),
      ),
    );

    yield* applyMigrationsTo(openRDBClient(dbPath)).pipe(
      Effect.mapError(
        (cause) =>
          new LegacyDatabaseRebuildFailed({
            message: `Failed to create a new database: ${dbPath}`,
            backupPath: incomplete.backupPath,
            cause,
          }),
      ),
    );

    logger.warnWithSentry({
      message:
        'Rebuilt the database because the database created by Sequelize could not be taken over',
      stack: incomplete,
      details: {
        backupPath: incomplete.backupPath,
        setAsidePath,
        reason: incomplete.reason._tag,
        issues: match(incomplete.reason)
          .with({ _tag: 'LegacySchemaIrreconcilable' }, (r) => r.issues)
          .with({ _tag: 'LegacyTakeoverFailed' }, () => [])
          .exhaustive(),
      },
    });
    return {
      kind: 'rebuilt' as const,
      backupPath: incomplete.backupPath,
      setAsidePath,
      reason: incomplete.reason,
    };
  });

/**
 * 開いている DB に、未適用のマイグレーションを適用する。
 *
 * Sequelize の時代に作られた DB は、引き継ぎを終えるまで、試すたびに複製を残してから引き継ぐ
 * （`./legacyTakeover.ts`）。引き継げなければ `rebuildUntakeableDatabase` で作り直し、
 * 結果の `rebuilt` で呼び出し元に全件の同期と利用者への知らせを求める。
 * 適用済みのマイグレーションは飛ばすので、起動のたびに呼んでよい。
 * 起動時の初期化（`settingsController` の Step 1）から呼ばれる。
 *
 * @throws LegacyTakeoverError | LegacyDatabaseNotRebuildable | LegacyDatabaseRebuildFailed
 *   引き継ぎも作り直しもできなかった。DB は元のままだが、`LegacyDatabaseRebuildFailed` では
 *   退避先（`backups`）へ移った後のことがある。その場合も次の起動は空の DB から全件の同期で埋め直す
 */
export const migrateRDBClient = async (): Promise<MigrateOutcome> => {
  const program = applyMigrationsTo(getRDBClient()).pipe(
    Effect.as<MigrateOutcome>({ kind: 'migrated' }),
    Effect.catchTag('LegacyTakeoverIncomplete', rebuildUntakeableDatabase),
  );
  const exit = await Effect.runPromiseExit(program);
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    logger.error({
      message: 'Database migration failed',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
  return exit.value;
};

const assertTestEnv = (): void => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('NODE_ENV is not test');
  }
};

/**
 * テスト用のメモリ上の DB を開き、マイグレーションを適用する。
 * テストのファイルごとに `__cleanupTestRDBClient` で閉じる。
 */
export const __initTestRDBClient = async (): Promise<void> => {
  assertTestEnv();
  openRDBClient(':memory:');
  await migrateRDBClient();
};

/** テスト用の DB のアプリのテーブルを空にする。テストごとに前のテストの行を消すために使う */
export const __resetTestRDBClient = (): void => {
  assertTestEnv();
  const db = getDB();
  db.transaction((tx) => {
    for (const table of appTables) {
      tx.delete(table).run();
    }
  });
};

/** テスト用の DB を閉じる */
export const __cleanupTestRDBClient = (): void => {
  closeRDBClient();
};
