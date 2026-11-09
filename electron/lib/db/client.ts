import { DatabaseSync } from 'node:sqlite';

import type { EmptyRelations } from 'drizzle-orm';
import {
  drizzle,
  type NodeSQLiteDatabase,
  type NodeSQLiteTransaction,
} from 'drizzle-orm/node-sqlite';

import { logger } from '../logger';
import { applyMigrations } from './migrate';
import { appTables } from './schema';

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

/**
 * 開いている DB に、未適用のマイグレーションを適用する。
 *
 * Sequelize の時代に作られた DB は、初回だけ複製を残してから引き継ぐ（`./legacyTakeover.ts`）。
 * 適用済みのマイグレーションは飛ばすので、起動のたびに呼んでよい。
 * 起動時の初期化（`settingsController` の Step 1）から呼ばれる。
 */
export const migrateRDBClient = async (): Promise<void> => {
  const client = getRDBClient();
  await applyMigrations({
    db: client.db,
    sqlite: client.sqlite,
    dbPath: client.path,
  });
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
