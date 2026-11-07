import path from 'node:path';

import {
  type Event,
  type EventHint,
  init as initSentry,
} from '@sentry/electron/main';
import { app, type BrowserWindow, ipcMain } from 'electron';

// electron-is-dev 3.0 は Pure ESM のため CommonJS ビルドと互換性がない
// Electron ネイティブの app.isPackaged を使用
const isDev = !app.isPackaged;

import { scrubEventData } from '../src/lib/utils/masking';
import { router } from './api';
import { SENTRY_DATA_COLLECTION } from './constants/sentryDataCollection';
import * as electronUtil from './electronUtil';
import { initializeSettingStoreForUtil } from './electronUtil';
import { getHost, registerHost } from './lib/host';
import { createElectronHost } from './lib/host/electronHost';
import { logger } from './lib/logger';
import * as sequelizeClient from './lib/sequelize';
import { serveOverElectronIpc } from './lib/trpcTransport/electronIpcChannel';
import { serveTrpc } from './lib/trpcTransport/serveTrpc';
import { getBackgroundUsecase } from './module/backGroundUsecase';
import { startBackgroundSyncTimer } from './module/logSync/backgroundTimer';
import { initSettingStore } from './module/settingStore';
import { hasAcceptedCurrentTerms } from './module/terms/consent';
import { startThumbnailCacheCleanupScheduler } from './module/vrchatPhoto/thumbnailCacheCleanupScheduler';
import { eventEmitter } from './trpc';

// electron/module のサービスは getHost() から OS の機能を受け取る。
// どのサービスより先に殻を登録するため、モジュール本体の最初の処理として登録する
registerHost(createElectronHost());

// tRPC の接続はウィンドウごとに張る。トレイや二重起動から開き直したウィンドウは
// 新しい webContents を持つので、最初のウィンドウだけにつなぐと応答が届かない。
// browser-window-created は BrowserWindow のコンストラクタの中で同期的に発火し、
// createWindow が loadURL を呼ぶより先に届くので、画面が送り始める前に接続できる。
// アプリは window.open を拒否しており、BrowserWindow を作るのは createWindow だけなので、
// webContents 1 つにつき接続は 1 つになる。ウィンドウより先に登録するためモジュールの読み込み時に登録する。
// ctx は electron/trpc.ts の initTRPC.context が宣言する形で渡す。procedure は ctx を読まず、
// イベントは electron/trpc.ts の eventEmitter を直接使う
app.on('browser-window-created', (_event, window) => {
  serveOverElectronIpc(
    window.webContents,
    (channel) =>
      serveTrpc({
        router,
        createContext: () => ({ eventEmitter }),
        channel,
      }),
    ipcMain,
  );
});

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
      // 開発環境でも、現在の版の規約に同意しているかを確かめる
      if (!hasAcceptedCurrentTerms(settingStore)) {
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
    .join(getHost().info.paths.userData, 'db.sqlite')
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

  await createOrGetMainWindow();

  void electronUtil.setTray();
  startThumbnailCacheCleanupScheduler();

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
  electronUtil.revealWindow(electronUtil.createOrGetWindow());
});

// macOS では起動直後（ウィンドウの描画前）にも activate が届く。描画前のウィンドウは
// revealWindow が見せないので、最初の表示は createWindow の ready-to-show に任せられる
app.on(
  'activate',
  () =>
    void (async () => {
      electronUtil.revealWindow(await createOrGetMainWindow());
    })(),
);

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  // background処理が有効になっている場合は終了しない
  if (backgroundUsecase.getIsEnabledBackgroundProcess()) {
    startBackgroundSyncTimer(settingStore);
    return;
  }
  app.quit();
});
