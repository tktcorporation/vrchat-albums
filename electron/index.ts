import path from 'node:path';

import {
  type Event,
  type EventHint,
  init as initSentry,
} from '@sentry/electron/main';
import { app, type BrowserWindow } from 'electron';

// electron-is-dev 3.0 は Pure ESM のため CommonJS ビルドと互換性がない
// Electron ネイティブの app.isPackaged を使用
const isDev = !app.isPackaged;

// Packages
import { createIPCHandler } from 'trpc-electron/main';

import { scrubEventData } from '../src/lib/utils/masking';
import { router } from './api';
import { SENTRY_DATA_COLLECTION } from './constants/sentryDataCollection';
import * as electronUtil from './electronUtil';
import { initializeSettingStoreForUtil } from './electronUtil';
import { logger } from './lib/logger';
import * as sequelizeClient from './lib/sequelize';
import { getAppUserDataPath } from './lib/wrappedApp';
import { getBackgroundUsecase } from './module/backGroundUsecase';
import { initSettingStore } from './module/settingStore';

const settingStore = initSettingStore();
initializeSettingStoreForUtil();

let isSentryInitializedMain = false;
export const getIsSentryInitializedMain = () => isSentryInitializedMain; // Sentry初期化フラグ exportする

export interface ErrorEvent extends Event {
  type: undefined;
}

// Sentryの初期化関数 exportする
export const initializeMainSentry = () => {
  if (isSentryInitializedMain) {
    logger.info('Sentry already initialized in main process.');
    return;
  }
  // SENTRY_DSN がなければ初期化しない
  if (!process.env.SENTRY_DSN) {
    logger.info('Sentry not initialized in main process (SENTRY_DSN not set)');
    return;
  }

  logger.info(
    `Sentry initializing in main process via electron/index.ts: isDev: ${isDev}`,
  );
  initSentry({
    dsn: process.env.SENTRY_DSN,
    environment: isDev ? 'development' : 'production',
    debug: isDev,
    // __SENTRY_RELEASE__ はビルド時に Sentry プラグインによって置換される
    // リリースバージョンを表す定数
    release: __SENTRY_RELEASE__,
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeSend: (event: ErrorEvent, _hint: EventHint) => {
      // 開発環境でも規約同意をチェックする
      if (!settingStore.getTermsAccepted()) {
        if (isDev) {
          logger.info(
            'Sentry event dropped in development mode due to terms not accepted.',
          );
        } else {
          logger.info('Sentry event dropped due to terms not accepted.');
        }
        return null;
      }

      const processedEvent = scrubEventData(event);

      if (isDev) {
        logger.info('Sentry event sent in development mode.');
      }

      return processedEvent;
    },
  });
  logger.info(
    isDev
      ? 'Sentry initialized in main process for development (terms check enabled).'
      : 'Sentry initialized in main process via electron/index.ts. Event sending depends on terms acceptance.',
  );
  isSentryInitializedMain = true;
};

// アプリ起動時に初期化試行
initializeMainSentry();

const backgroundUsecase = getBackgroundUsecase(settingStore);

/**
 * 既存のメインウィンドウを取得し、なければ新規作成する非同期関数。
 * 初期化処理やアクティベート時に呼び出される。
 */
const createOrGetMainWindow = async (): Promise<BrowserWindow> => {
  const mainWindow = electronUtil.createOrGetWindow();
  // 他のウィンドウ設定やイベントリスナーをここに追加
  return mainWindow;
};

/**
 * SQLite データベースクライアントを初期化する。
 * ファイルパスはユーザーデータディレクトリ配下に生成される。
 */
const initializeRDBClient = async () => {
  const filePath = path
    .join(getAppUserDataPath(), 'db.sqlite')
    .split(path.sep)
    .join(path.posix.sep);
  await sequelizeClient.initRDBClient({
    db_url: filePath,
  });
};

/**
 * アプリケーション全体の初期化を行うメイン関数。
 * ウィンドウ生成や IPC ハンドラ登録、Sentry 設定をここで実行する。
 */
const initializeApp = async () => {
  // Skip single instance lock in Playwright tests
  if (!process.env.PLAYWRIGHT_TEST) {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
      return;
    }
  }

  // データベースクライアント初期化
  await initializeRDBClient();

  const mainWindow = await createOrGetMainWindow();

  createIPCHandler({
    router,
    windows: [mainWindow],
  });
  void electronUtil.setTray();

  // electron-unhandled は top-level await を含む ESM のため、CJS の main バンドルから
  // require() で読めない。外部モジュールのまま動的 import で読み込む。
  const { default: unhandled } = await import('electron-unhandled');
  unhandled({
    logger: (error) => logger.error({ message: error }),
  });
};

app
  .whenReady()
  .then(initializeApp)
  .catch((error) => logger.error({ message: error }));

process.on('uncaughtException', (error) => logger.error({ message: error }));
process.on('unhandledRejection', (error) => logger.error({ message: error }));

app.on('second-instance', () => {
  const mainWindow = electronUtil.createOrGetWindow();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on(
  'activate',
  () =>
    void (async () => {
      const mainWindow = await createOrGetMainWindow();
      mainWindow.show();
      mainWindow.focus();
    })(),
);

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  // background処理が有効になっている場合は終了しない
  if (backgroundUsecase.getIsEnabledBackgroundProcess()) {
    electronUtil.setTimeEventEmitter(settingStore);
    return;
  }
  app.quit();
});
