import { QueryTypes, Sequelize } from '@sequelize/core';
import { SqliteDialect } from '@sequelize/sqlite3';
import path from 'pathe';
import { match } from 'ts-pattern';
import { uuidv7 } from 'uuidv7';

import { VRChatPhotoPathModel } from '../module/vrchatPhoto/model/vrchatPhotoPath.model';
import { VRChatPhotoMetadataModel } from '../module/vrchatPhotoMetadata/vrchatPhotoMetadata.model';
import { VRChatPlayerJoinLogModel } from '../module/VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { VRChatPlayerLeaveLogModel } from '../module/VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import { VRChatWorldJoinLogModel } from '../module/vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { VRChatWorldJoinLogFromPhotoModel } from '../module/vrchatWorldJoinLogFromPhoto/vrchatWorldJoinLogFromPhoto.model';
import * as settingService from './../module/settings/service';
import { logger } from './logger';
import { Migrations } from './sequelize/migrations.model';
import { computeSchemaFingerprint } from './sequelize/schemaFingerprint';

let rdbClient: ReturnType<typeof _newRDBClient> | null = null;
let migrationProgeress = false;

/**
 * Sequelize の `retry-as-promised` に渡す識別子。
 * Sentry のエラー集約・診断容易性のため `electron/lib/sequelize.ts` と
 * 同設定の不変条件テストで共有する。詳細: docs/adr/004-no-sequelize-retry-timeout.md
 */
export const SEQUELIZE_RETRY_NAME = 'sequelize-query';

type SequelizeOptions = ConstructorParameters<typeof Sequelize>[0] & {
  storage: string;
};
/**
 * Sequelize クライアントを生成する内部関数。
 * 返り値は接続情報を保持したオブジェクト。
 */
const _newRDBClient = (props: { db_url: string }) => {
  const sequelizeOptions: SequelizeOptions = {
    dialect: SqliteDialect,
    storage: props.db_url,
    // retry-as-promised に渡る設定。詳細: docs/adr/004-no-sequelize-retry-timeout.md
    // - timeout は意図的に未指定。主な壁時間制御は SQLite の busy_timeout=5000 PRAGMA と
    //   DBQueue の timeout=60000 に委譲する。ただし DBQueue の timeout は DBQueue 経由
    //   タスクのみに適用される点に注意（PRAGMA 設定や sync() は対象外）。
    // - max は SQLITE_BUSY 等の一過性エラー回復に必要な最小限。
    //   Effect 上位リトライとの合算待機を抑えるため小さく保つ。
    // - name は Sentry 集約・診断容易性のための識別子。
    retry: {
      max: 3,
      name: SEQUELIZE_RETRY_NAME,
    },
    models: [
      VRChatWorldJoinLogModel,
      VRChatWorldJoinLogFromPhotoModel,
      VRChatPlayerJoinLogModel,
      VRChatPlayerLeaveLogModel,
      VRChatPhotoPathModel,
      VRChatPhotoMetadataModel,
      // TODO: アプリイベントモデルは今後実装
      // VRChatAppEventModel,
      Migrations,
    ],
  };
  logger.debug(`sequelizeOptions: ${JSON.stringify(sequelizeOptions)}`);
  const client = new Sequelize(sequelizeOptions);
  return {
    __db_url: props.db_url,
    __client: client,
  };
};

/**
 * SQLite の PRAGMA を設定する。
 * - journal_mode=WAL: 読み書きの並行処理を可能にする
 * - busy_timeout=5000: DB ロック時に最大5秒待機する
 * - synchronous=NORMAL: WAL モード下では安全。各トランザクションの fsync を省略し書き込み I/O を削減
 * - cache_size=-50000: ページキャッシュを 50MB に拡張（デフォルト ~2MB）。バッチ処理時のページ入れ替えを抑制
 * - temp_store=MEMORY: ソート等のテンポラリ処理をメモリで実行
 */
const configureSQLitePragmas = async (client: Sequelize): Promise<void> => {
  await client.query('PRAGMA journal_mode=WAL');
  await client.query('PRAGMA busy_timeout=5000');
  await client.query('PRAGMA synchronous=NORMAL');
  await client.query('PRAGMA cache_size=-50000');
  await client.query('PRAGMA temp_store=MEMORY');
  logger.info(
    'SQLite PRAGMAs configured: journal_mode=WAL, busy_timeout=5000, synchronous=NORMAL, cache_size=50MB, temp_store=MEMORY',
  );
};

/**
 * 外部から呼び出される初期化関数。
 * `_initRDBClient` をラップしている。
 */
export const initRDBClient = async (props: { db_url: string }) => {
  const client = _initRDBClient({
    db_url: props.db_url,
  });
  await configureSQLitePragmas(client.__client);
  return client;
};

/**
 * グローバルな `rdbClient` を初期化する内部関数。
 * 既に初期化されている場合はエラーを投げる。
 */
const _initRDBClient = (props: { db_url: string }) => {
  if (rdbClient !== null) {
    if (rdbClient.__db_url !== props.db_url) {
      throw new Error(
        `rdbClient is already initialized with ${rdbClient.__db_url}`,
      );
    }
    throw new Error(
      `rdbClient is already initialized with ${rdbClient.__db_url}`,
    );
  }
  rdbClient = _newRDBClient({
    db_url: props.db_url,
  });
  return rdbClient;
};

/**
 * テスト用の RDBClient を初期化する
 */
export const __initTestRDBClient = async () => {
  // テスト環境でなければエラー
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('NODE_ENV is not test');
  }
  // const dbPath = ':memory:';
  const dbPath = path.join(process.cwd(), 'debug', 'db', `test.${uuidv7()}.db`);
  const client = _initRDBClient({
    db_url: dbPath,
  });
  await configureSQLitePragmas(client.__client);
  return client;
};
/**
 * テスト用に生成した RDBClient を破棄しリセットする。
 */
export const __cleanupTestRDBClient = async () => {
  if (rdbClient === null) {
    return;
  }
  await rdbClient.__client.close();
  rdbClient = null;
};

/**
 * 初期化済みの RDBClient を取得する。
 * 未初期化の場合は例外を送出する。
 */
export const getRDBClient = () => {
  if (rdbClient === null) {
    throw new Error('rdbClient is not initialized');
  }
  return rdbClient;
};

/**
 * sync 対象のモデル一覧。
 * Migrations はスキーマ管理用なので最後に同期する。
 */
const SYNC_MODELS = [
  VRChatWorldJoinLogModel,
  VRChatWorldJoinLogFromPhotoModel,
  VRChatPlayerJoinLogModel,
  VRChatPlayerLeaveLogModel,
  VRChatPhotoPathModel,
  VRChatPhotoMetadataModel,
  Migrations,
] as const;

/**
 * 現在のモデル定義から算出したスキーマ指紋。
 * `Migrations.schemaFingerprint` に記録された値と比べて、スキーマ同期の要否を決める。
 */
export const getCurrentSchemaFingerprint = (): string =>
  computeSchemaFingerprint(SYNC_MODELS);

/**
 * Sequelize の sync を実行する共通処理。
 * モデルごとに分割して実行し、DB ロック時間を短縮する。
 * 全モデルの同期が成功した後にだけ、アプリバージョンとスキーマ指紋を `Migrations` に記録する。
 * 途中で失敗した場合は指紋が残らないため、次回起動時に同期をやり直す。
 */
const executeSyncRDB = async (options: { force: boolean }) => {
  // 実行中は何もしない
  if (migrationProgeress) {
    logger.info('migrationProgeress');
    return;
  }

  // フラグを立てる前に算出する。ここで例外が出てもフラグが立ったまま残らないようにするため
  const appVersion = settingService.getAppVersion();
  const schemaFingerprint = getCurrentSchemaFingerprint();
  migrationProgeress = true;
  // effect-lint-allow-try-catch: finally でマイグレーション進行フラグをリセットするため必要
  try {
    // モデルごとに分割して sync を実行
    for (const model of SYNC_MODELS) {
      const modelName = model.name;
      const startTime = performance.now();
      await model.sync({
        force: options.force,
        alter: true,
      });
      const elapsed = performance.now() - startTime;
      logger.info(
        `executeSyncRDB: ${modelName} synced in ${elapsed.toFixed(0)}ms`,
      );
    }

    // Migrations は SYNC_MODELS の最後に同期されるため、この時点で schemaFingerprint 列が存在する
    await Migrations.create({
      version: appVersion,
      migratedAt: new Date(),
      schemaFingerprint,
    });
  } finally {
    migrationProgeress = false;
  }
};

/**
 * 必要に応じてデータベースを同期するラッパー関数。
 *
 * checkRequired=true（デフォルト）の場合、`Migrations` に記録されたスキーマ指紋と
 * 現在のモデル定義の指紋を比べ、一致すればスキーマ同期をスキップする。
 * SQLite の `sync({ alter: true })` は差分が無くても全列でテーブルを作り直し、
 * 行数に比例して起動を待たせるため、モデル定義が変わったときだけ実行する。
 * アプリバージョンだけが変わった更新では同期しない。
 */
export const syncRDBClient = async (options?: { checkRequired: boolean }) => {
  const checkRequired = options?.checkRequired ?? true;

  const migrationRequired = await match(checkRequired)
    .with(true, () => checkMigrationRDBClient())
    .with(false, () => true)
    .exhaustive();

  if (!migrationRequired) {
    logger.info('syncRDBClient: schema fingerprint unchanged, skipping sync');
    return;
  }

  logger.info('syncRDBClient: schema fingerprint changed, syncing');
  await executeSyncRDB({ force: false });
};

/**
 * テスト用の強制的なDB同期を行う関数
 * 既存のテーブルを削除して再作成する
 */
export const __forceSyncRDBClient = async () => {
  // テスト環境でなければエラー
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('NODE_ENV is not test');
  }

  // TODO: データベースのバックアップを行う

  await executeSyncRDB({ force: true });
};

/**
 * migration の必要があるかどうかを確認する
 * true: migration が必要（指紋が未記録、または現在のモデル定義と異なる）
 * false: migration が不要
 */
export const checkMigrationRDBClient = async (): Promise<boolean> => {
  const storedFingerprint = await findStoredSchemaFingerprint();
  return storedFingerprint !== getCurrentSchemaFingerprint();
};

/**
 * 最後に成功した同期で記録したスキーマ指紋を返す。
 *
 * `Migrations` テーブルが無い DB と、`Migrations` に指紋列が無い DB は
 * null を返す。列の有無を先に確かめるのは、列が無いまま `Migrations.findOne` を発行すると
 * SELECT 句の `schemaFingerprint` が SQLite エラーになるため。
 */
const findStoredSchemaFingerprint = async (): Promise<string | null> => {
  const columns = await getRDBClient().__client.query<{ name: string }>(
    "SELECT name FROM pragma_table_info('Migrations')",
    { type: QueryTypes.SELECT },
  );
  if (!columns.some((column) => column.name === 'schemaFingerprint')) {
    return null;
  }

  // id は AUTOINCREMENT で単調増加するため、同一ミリ秒に複数行あっても最後の同期を一意に選べる
  const latestMigration = await Migrations.findOne({
    order: [['id', 'DESC']],
  });
  return latestMigration?.schemaFingerprint ?? null;
};
