// 処理本体（./api など）が読み込まれた時点で殻の値を使うため、殻の登録を最初に評価する
import './registerElectronHost';
import path from 'node:path';

import { app, type BrowserWindow } from 'electron';

import { router } from './api';
import * as electronUtil from './electronUtil';
import { initializeSettingStoreForUtil } from './electronUtil';
import { getHost } from './lib/host';
import { logger } from './lib/logger';
import { initializeMainSentry } from './lib/sentryMain';
import * as sequelizeClient from './lib/sequelize';
import { startTrpcServer } from './lib/trpcTransport';
import { getBackgroundUsecase } from './module/backGroundUsecase';
import { startBackgroundSyncTimer } from './module/logSync/backgroundTimer';
import { initSettingStore } from './module/settingStore';
import { startThumbnailCacheCleanupScheduler } from './module/vrchatPhoto/thumbnailCacheCleanupScheduler';
import { eventEmitter } from './trpc';

// tRPC の接続はウィンドウごとに張り、ウィンドウが作られた瞬間に接続する（startTrpcServer）。
// 最初のウィンドウより先に待ち受けを始めるため、モジュールの読み込み時に呼ぶ。
// アプリは window.open を拒否しており、BrowserWindow を作るのは createWindow だけなので、
// webContents 1 つにつき接続は 1 つになる。アプリの終了まで止めないので、戻り値の停止関数は使わない。
// ctx は electron/trpc.ts の initTRPC.context が宣言する形で渡す。procedure は ctx を読まず、
// イベントは electron/trpc.ts の eventEmitter を直接使う
startTrpcServer({ router, createContext: () => ({ eventEmitter }) });

const settingStore = initSettingStore();
initializeSettingStoreForUtil();

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
