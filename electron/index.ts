import path from 'node:path';
import {
  type Event,
  type EventHint,
  init as initSentry,
} from '@sentry/electron/main';
import { app, type BrowserWindow, ipcMain } from 'electron';
import isDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
// Packages
import { createIPCHandler } from 'trpc-electron/main';
import { scrubEventData } from '../src/lib/utils/masking';
import { router } from './api';
import * as electronUtil from './electronUtil';
import { initializeSettingStoreForUtil } from './electronUtil';
import { logger } from './lib/logger';
import * as sequelizeClient from './lib/sequelize';
import { getAppUserDataPath } from './lib/wrappedApp';
import { getBackgroundUsecase } from './module/backGroundUsecase';
import { initSettingStore } from './module/settingStore';

const settingStore = initSettingStore();
initializeSettingStoreForUtil();

export let isSentryInitializedMain = false; // Sentry初期化フラグ exportする

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
    beforeSend: (event: ErrorEvent, _hint: EventHint) => {
      // 開発環境でも規約同意をチェックする
      if (settingStore.getTermsAccepted() !== true) {
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

const CHANNELS = {
  ERROR_MESSAGE: 'error-message',
  TOAST: 'toast',
};

/**
 * ipcMain ハンドラを登録し、設定の取得や保存、エラー通知を受け付ける。
 * レンダラープロセスからの通信窓口として初期化時に呼び出される。
 */
const registerIpcMainListeners = () => {
  ipcMain.on(CHANNELS.ERROR_MESSAGE, (_, message) => {
    logger.error({
      message,
    });
  });

  // 設定の取得
  ipcMain.handle('get-setting', (_, key: string) => {
    switch (key) {
      case 'termsAccepted':
        return settingStore.getTermsAccepted();
      case 'termsVersion':
        return settingStore.getTermsVersion();
      default:
        return null;
    }
  });

  // 設定の保存
  ipcMain.handle('set-setting', (_, key: string, value: unknown) => {
    switch (key) {
      case 'termsAccepted':
        settingStore.setTermsAccepted(value as boolean);
        break;
      case 'termsVersion':
        settingStore.setTermsVersion(value as string);
        break;
    }
  });
};

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
  sequelizeClient.initRDBClient({
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

  registerIpcMainListeners();
  const mainWindow = await createOrGetMainWindow();
  createIPCHandler({
    router,
    windows: [mainWindow],
  });
  electronUtil.setTray();

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
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('activate', async () => {
  const mainWindow = await createOrGetMainWindow();
  mainWindow.show();
  mainWindow.focus();
});

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
