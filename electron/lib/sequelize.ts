import { Sequelize } from '@sequelize/core';
import { SqliteDialect } from '@sequelize/sqlite3';
import { Effect } from 'effect';
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
    // - timeout は意図的に未指定。クエリ全体への壁時間は SQLite の
    //   busy_timeout=5000 PRAGMA と DBQueue の timeout=60000 で代替済み。
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

// 共通の sync 処理を抽出した関数
/**
 * Sequelize の sync を実行する共通処理。
 * モデルごとに分割して実行し、DB ロック時間を短縮する。
 * マイグレーション情報の記録も行う。
 */
const executeSyncRDB = async (options: { force: boolean }) => {
  // 実行中は何もしない
  if (migrationProgeress) {
    logger.info('migrationProgeress');
    return;
  }

  migrationProgeress = true;
  const appVersion = settingService.getAppVersion();
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

    // migration のバージョンを保存
    const now = new Date();
    await Migrations.create({
      version: appVersion,
      migratedAt: now,
    });
  } finally {
    migrationProgeress = false;
  }
};

/**
 * 必要に応じてデータベースを同期するラッパー関数。
 *
 * checkRequired=true（デフォルト）の場合、Migrations テーブルを確認し、
 * 現在のアプリバージョンと一致する migration が既にあればスキーマ同期をスキップする。
 * これにより同一バージョンでの再起動時に不要な ALTER TABLE を回避する。
 */
export const syncRDBClient = async (options?: { checkRequired: boolean }) => {
  const checkRequired = options?.checkRequired ?? true;
  const appVersion = settingService.getAppVersion();

  // match() の結果を await して、async コールバックの Promise を正しく解決する。
  // 旧コードでは await が欠落しており、Promise オブジェクト（truthy）が
  // そのまま評価されていたため、スキップ判定が機能していなかった。
  const migrationRequired = await match(checkRequired)
    .with(true, () => checkMigrationRDBClient(appVersion))
    .with(false, () => true)
    .exhaustive();

  if (!migrationRequired) {
    logger.info(
      `syncRDBClient: schema already up-to-date for v${appVersion}, skipping sync`,
    );
    return;
  }

  logger.info(`syncRDBClient: migration required for v${appVersion}, syncing`);
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
 * true: migration が必要
 * false: migration が不要
 */
export const checkMigrationRDBClient = async (appVersion: string) => {
  // Migrations テーブルが存在しない場合は migration が必要
  const migrationsTableExists = await isExistsMigrationTable();
  if (!migrationsTableExists) {
    return true;
  }

  // 実施積みで最新の migration を取得
  const latestMigration = await Migrations.findOne({
    order: [['createdAt', 'DESC']],
  });
  // 初回は migration が必要
  if (latestMigration === null) {
    return true;
  }
  // 同じバージョンの migration が存在するか確認
  if (appVersion === latestMigration.version) {
    return false;
  }
  return true;
};

/**
 * `Migrations` テーブルが存在するか確認する内部関数。
 */
const isExistsMigrationTable = (): Promise<boolean> =>
  Effect.runPromise(
    Effect.tryPromise({
      try: () => Migrations.findAll(),
      catch: (e): boolean => {
        return match(e)
          .with({ name: 'SequelizeDatabaseError' }, () => false)
          .otherwise(() => {
            throw e; // 予期しないエラーはre-throw
          });
      },
    }).pipe(
      Effect.map(() => true),
      Effect.catchAll((isFalse) => Effect.succeed(isFalse)),
    ),
  );
