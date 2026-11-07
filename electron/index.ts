/**
 * main プロセスの入口。ウィンドウ・トレイ・自動更新・OS の操作・エラー監視の初期化を受け持つ。
 *
 * tRPC の router・サービス・DB・worker は処理本体（utilityProcess、入口は `electron/backend/main.ts`）で動かし、
 * main は読み込まない。main と処理本体の分担とつなぎ方は `electron/lib/trpcTransport/index.ts` の JSDoc にある。
 */
import { captureException, captureMessage } from '@sentry/electron/main';
import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

import * as electronUtil from './electronUtil';
import { createBackendSupervisor } from './lib/backendProcess/supervisor';
import {
  createElectronHostInfo,
  createElectronHostShell,
} from './lib/host/electronHost';
import { createElectronUpdater } from './lib/host/electronUpdater';
import { configureErrorReporting, logger } from './lib/logger';
import {
  initializeMainSentry,
  isMainSentryInitialized,
} from './lib/sentryMain';
import {
  readSettingsSnapshot,
  resolveSettingStoreName,
  settingStoreFilePath,
} from './lib/settingsFile';
import { startTrpcBroker } from './lib/trpcTransport';

const hostInfo = createElectronHostInfo(app);

const settingsFilePath = settingStoreFilePath(
  hostInfo.paths.userData,
  resolveSettingStoreName(),
);
/** 設定ファイルを書くのは処理本体なので、main は使うたびに読み直す */
const readSettings = () => readSettingsSnapshot(settingsFilePath);

configureErrorReporting({
  source: 'electron-main',
  isTermsAccepted: () => readSettings().termsAccepted,
  captureException,
  captureMessage,
});

// 処理本体のイベントの送り道は、SDK の初期化が utilityProcess.fork を包むことで作られる。
// 処理本体の起動より先に初期化する
initializeMainSentry(readSettings);

/** 処理本体の起動し直しを諦めたときにアプリを終えるため、終了の待ちを飛ばす印 */
let quitWithoutBackend = false;

const backend = createBackendSupervisor({
  hostInfo,
  errorReporting: isMainSentryInitialized(),
  shell: createElectronHostShell({
    reloadWindow: electronUtil.reloadMainWindow,
    onTermsAccepted: () => initializeMainSentry(readSettings),
  }),
  updater: createElectronUpdater(autoUpdater),
  // 処理本体の中の接続と購読は失われたので、画面を読み込み直して接続を張り直す
  onRestarted: () => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.reload();
    }
  },
  onGiveUp: () => {
    dialog.showErrorBox(
      'VRChat Albums',
      'アプリの処理を続けられなくなったため終了します。もう一度起動してください。',
    );
    quitWithoutBackend = true;
    app.quit();
  },
});

// preload は文書が読み込まれるたびに port を頼む。最初のウィンドウより先に受け付けを始めるため、
// モジュールの読み込み時に呼ぶ。アプリの終了まで止めないので、戻り値の停止関数は使わない
startTrpcBroker({ backend });

electronUtil.initializeWindowBoundsStore({
  load: () => readSettings().windowBounds,
  save: (bounds) => backend.send({ kind: 'setWindowBounds', bounds }),
});

/**
 * アプリケーション全体の初期化を行うメイン関数。
 * 処理本体の起動とウィンドウの生成を行う。ウィンドウは処理本体の準備を待たずに作り、
 * 画面からの要求は処理本体の準備が済むまで処理本体の側で待たせる。
 */
const initializeApp = async () => {
  // Skip single instance lock in Playwright tests
  if (!process.env.PLAYWRIGHT_TEST) {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      quitWithoutBackend = true;
      app.quit();
      return;
    }
  }

  backend.start();

  electronUtil.createOrGetWindow();

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
  electronUtil.revealWindow(electronUtil.createOrGetWindow());
});

// macOS では起動直後（ウィンドウの描画前）にも activate が届く。描画前のウィンドウは
// revealWindow が見せないので、最初の表示は createWindow の ready-to-show に任せられる
app.on('activate', () => {
  electronUtil.revealWindow(electronUtil.createOrGetWindow());
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  // background処理が有効になっている場合は終了しない
  if (readSettings().backgroundFileCreateFlag) {
    backend.send({ kind: 'startBackgroundSync' });
    return;
  }
  app.quit();
});

// 処理本体に DB を閉じさせてから終える。終了の途中で DB への書き込みが切れないようにするため。
// ウィンドウはこの後に閉じるので、位置と大きさは処理本体が動いているうちに保存を頼む
app.on('before-quit', (event) => {
  if (quitWithoutBackend) {
    return;
  }
  event.preventDefault();
  electronUtil.saveMainWindowBounds();
  void backend.stop().finally(() => {
    quitWithoutBackend = true;
    app.quit();
  });
});
