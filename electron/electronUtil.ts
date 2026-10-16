// Native
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Effect } from 'effect';
// Packages
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  screen, // Ensure screen is imported
  shell,
  Tray,
} from 'electron';

// electron-is-dev 3.0 は Pure ESM のため CommonJS ビルドと互換性がない
// Electron ネイティブの app.isPackaged を使用
const isDev = !app.isPackaged;

import {
  type AppEntry,
  checkExternalUrl,
  decideNavigation,
} from './lib/externalUrl';
import { logger } from './lib/logger';
// Local
import { getSettingStore, type SettingStore } from './module/settingStore'; // Import the type

let settingStore: SettingStore | null = null;

const WINDOW_CONFIG = {
  DEFAULT_WIDTH: 1024,
  DEFAULT_HEIGHT: 768,
  MIN_WIDTH: 800,
  MIN_HEIGHT: 600,
} as const;

type DisplayMetricsError =
  | { code: 'WINDOW_DESTROYED'; message: string }
  | { code: 'BOUNDS_ADJUSTMENT_FAILED'; message: string };

/**
 * ウィンドウの webContents に、アプリ外への遷移・ウィンドウ生成・権限要求を
 * 塞ぐガードを登録する。
 *
 * レンダラーに外部由来の文字列（VRChat のログから読んだワールド名やプレイヤー名など）が入り込んでも、
 * ウィンドウがアプリ外のページを読み込んだり、OS のスキームハンドラを起動したりしない
 * ようにする。許可するのは、アプリ本体への遷移と、checkExternalUrl が許可した URL を
 * 既定のブラウザで開くことだけ。
 */
const hardenWebContents = (
  browserWindow: BrowserWindow,
  appEntry: AppEntry,
): void => {
  const { webContents } = browserWindow;

  // リンクのクリックやフォーム送信による遷移。アプリ外の https は既定のブラウザへ回す
  webContents.on('will-navigate', (event) => {
    match(decideNavigation(event.url, appEntry))
      .with({ action: 'allow' }, () => {
        // アプリ本体への遷移は preventDefault せずそのまま通す
      })
      .with({ action: 'openExternal' }, (decision) => {
        event.preventDefault();
        void shell.openExternal(decision.url);
      })
      .with({ action: 'block' }, (decision) => {
        event.preventDefault();
        logger.warn({
          message: `Blocked navigation outside the app: ${decision.reason.type} ${decision.reason.input}`,
        });
      })
      .exhaustive();
  });

  // target="_blank" や window.open。アプリ内に新しいウィンドウは作らない
  webContents.setWindowOpenHandler(({ url }) => {
    const checked = checkExternalUrl(url);
    if (checked.ok) {
      void shell.openExternal(checked.url);
    } else {
      logger.warn({
        message: `Blocked window.open: ${checked.rejection.type} ${checked.rejection.input}`,
      });
    }
    return { action: 'deny' };
  });

  // アプリは <webview> を使わないため、注入されたタグからのゲストページ生成を拒否する
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.warn({ message: 'Blocked <webview> attachment' });
  });

  // レンダラーはカメラ・通知・クリップボード読み取り等の権限を要する Web API を
  // 使わない（クリップボード操作と通知は main プロセスの tRPC 経由）ため、すべて拒否する
  webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      logger.warn({ message: `Denied permission request: ${permission}` });
      callback(false);
    },
  );
  webContents.session.setPermissionCheckHandler(() => false);
};

/**
 * メインウィンドウを生成するヘルパー関数。
 * 既存のウィンドウがなければ初期サイズで作成する。
 */
function createWindow(): BrowserWindow {
  if (!settingStore) {
    throw new Error('settingStore not initialized in electronUtil');
  }
  const savedBounds = settingStore.getWindowBounds(); // Uncomment and use this

  // Default width and height if no saved bounds
  let width: number = WINDOW_CONFIG.DEFAULT_WIDTH;
  let height: number = WINDOW_CONFIG.DEFAULT_HEIGHT;
  let x: number | undefined;
  let y: number | undefined;

  if (savedBounds) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;

    // Restore size, ensuring it's not smaller than min size and not larger than work area
    width = Math.max(
      WINDOW_CONFIG.MIN_WIDTH,
      Math.min(savedBounds.width, workArea.width),
    );
    height = Math.max(
      WINDOW_CONFIG.MIN_HEIGHT,
      Math.min(savedBounds.height, workArea.height),
    );

    // Restore position, ensuring it's within the work area
    // Adjust if the window would be off-screen
    if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
      x = Math.max(
        workArea.x,
        Math.min(savedBounds.x, workArea.x + workArea.width - width),
      );
      y = Math.max(
        workArea.y,
        Math.min(savedBounds.y, workArea.y + workArea.height - height),
      );
    }
  }

  const mainWindow = new BrowserWindow({
    width,
    height,
    x, // Use x from savedBounds or undefined
    y, // Use y from savedBounds or undefined
    minWidth: WINDOW_CONFIG.MIN_WIDTH,
    minHeight: WINDOW_CONFIG.MIN_HEIGHT,
    frame: false,
    titleBarStyle: 'hidden',
    show: true,
    fullscreenable: true,
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    // いずれも Electron の既定値と同じだが、既定値の変更や設定の書き換えで
    // 気づかないうちに緩まないよう明示する。preload は sandbox 内で動くよう
    // electron/vite.config.preload.ts で 'electron' 以外を 1 ファイルにバンドルしている。
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // 開発環境の場合、DevToolsを開く
  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }

  const port = process.env.PORT ?? 3000;
  const devServerUrl = `http://localhost:${port}`;
  const indexHtmlPath = join(__dirname, '../src/out/index.html');
  const appEntry: AppEntry = isDev
    ? { kind: 'devServer', origin: new URL(devServerUrl).origin }
    : { kind: 'file', pathname: pathToFileURL(indexHtmlPath).pathname };

  // ガードは読み込み開始より前に登録し、最初のページからナビゲーションを制限する
  hardenWebContents(mainWindow, appEntry);

  if (isDev) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(indexHtmlPath);
  }

  // For AppBar
  ipcMain.on('minimize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    } else {
      win.minimize();
    }
  });

  ipcMain.on('maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.restore();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('close', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return;
    }
    win.close();
  });

  // ウィンドウの状態を保存
  mainWindow.on('close', () => {
    if (!settingStore) {
      // It's unlikely to reach here if createWindow succeeded, but good for safety
      logger.error({
        message: 'settingStore not initialized in mainWindow close event',
      });
      return;
    }
    const bounds = mainWindow.getBounds();
    settingStore.setWindowBounds(bounds);
  });

  // ディスプレイ構成が変更された時のハンドリング
  const displayMetricsChangedHandler = (): Effect.Effect<
    void,
    DisplayMetricsError
  > => {
    // ウィンドウが破棄されているかチェック
    if (!mainWindow || mainWindow.isDestroyed()) {
      return Effect.fail({
        code: 'WINDOW_DESTROYED' as const,
        message: 'Window has been destroyed',
      });
    }

    return Effect.try({
      try: () => {
        const currentBounds = mainWindow.getBounds();
        const currentDisplay = screen.getDisplayNearestPoint({
          x: currentBounds.x,
          y: currentBounds.y,
        });

        // ウィンドウが表示可能な領域に収まるように調整
        const adjustedBounds = {
          width: Math.min(
            currentBounds.width,
            currentDisplay.workAreaSize.width,
          ),
          height: Math.min(
            currentBounds.height,
            currentDisplay.workAreaSize.height,
          ),
          x: Math.max(
            currentDisplay.workArea.x, // Ensure x is within workArea.x
            Math.min(
              currentBounds.x,
              currentDisplay.workArea.x +
                currentDisplay.workAreaSize.width -
                currentBounds.width,
            ),
          ),
          y: Math.max(
            currentDisplay.workArea.y, // Ensure y is within workArea.y
            Math.min(
              currentBounds.y,
              currentDisplay.workArea.y +
                currentDisplay.workAreaSize.height -
                currentBounds.height,
            ),
          ),
        };

        mainWindow.setBounds(adjustedBounds);
      },
      catch: (error): DisplayMetricsError => ({
        code: 'BOUNDS_ADJUSTMENT_FAILED' as const,
        message: `Failed to adjust window bounds: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
    });
  };

  const displayMetricsChangedWrapper = () => {
    const either = Effect.runSync(
      Effect.either(displayMetricsChangedHandler()),
    );
    if (either._tag === 'Left') {
      const error = either.left;
      match(error.code)
        .with('WINDOW_DESTROYED', () => {
          // ウィンドウが破棄されている場合はログ出力しない（正常な状態）
        })
        .with('BOUNDS_ADJUSTMENT_FAILED', () => {
          logger.error({
            message: `Display metrics changed handler error: ${error.message}`,
          });
        })
        .exhaustive();
    }
  };

  screen.on('display-metrics-changed', displayMetricsChangedWrapper);

  // ウィンドウ破棄時にイベントリスナーを削除
  mainWindow.once('closed', () => {
    screen.removeListener(
      'display-metrics-changed',
      displayMetricsChangedWrapper,
    );
  });

  return mainWindow;
}

let mainWindow: BrowserWindow | null = null;
/**
 * 既存の BrowserWindow を取得する。
 * 存在しない場合は null を返す。
 */
const getWindow = (): BrowserWindow | null => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    mainWindow = windows[0];
    return mainWindow;
  }
  return null;
};
/**
 * window が存在しなければ新しく作成する
 * 存在していれば取得する
 */
const createOrGetWindow = (): BrowserWindow => {
  const window = getWindow();
  if (window) {
    return window;
  }
  mainWindow = createWindow();
  return mainWindow;
};

/**
 * システムトレイに常駐させるための初期化処理を行う。
 * アプリ終了時に破棄され、ウィンドウ表示などのメニューを提供する。
 */
const setTray = () => {
  let tray: Tray | null = null;

  const createTray = async () => {
    if (tray !== null) {
      return;
    }

    const appPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const iconPath = join(appPath, 'assets', 'icon.png');

    // アイコンパスの存在確認
    const accessExit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => fs.access(iconPath),
        catch: () => ({ type: 'ICON_NOT_FOUND' as const, path: iconPath }),
      }),
    );
    if (accessExit._tag === 'Failure') {
      logger.error({ message: `トレイアイコンが見つかりません: ${iconPath}` });
      return;
    }
    logger.info({ message: `トレイアイコンが見つかりました: ${iconPath}` });

    // トレイ作成（同期処理だがエラーの可能性あり）
    const trayExit = Effect.runSyncExit(
      Effect.try({
        try: () => new Tray(iconPath),
        catch: (error) => ({
          type: 'TRAY_CREATE_FAILED' as const,
          message: JSON.stringify(error),
        }),
      }),
    );
    if (trayExit._tag === 'Failure') {
      logger.error({
        message: 'トレイの作成に失敗しました',
      });
      return;
    }
    tray = trayExit.value;
    logger.info({ message: 'トレイの作成に成功しました' });

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'ウィンドウを表示',
        click: () => {
          const window = createOrGetWindow();
          if (window.isMinimized()) {
            window.restore();
          }
          window.show();
          window.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'エラーログを開く',
        click: () => {
          const logPath = app.getPath('logs');
          void shell.openPath(logPath);
        },
      },
      { type: 'separator' },
      {
        label: '終了',
        click: () => {
          app.quit();
        },
      },
    ]);

    if (tray) {
      tray.setToolTip(app.name);
      tray.setContextMenu(contextMenu);

      // トレイアイコンクリック時にウィンドウを表示
      tray.on('click', () => {
        const window = createOrGetWindow();
        if (window.isMinimized()) {
          window.restore();
        }
        window.show();
        window.focus();
      });
    }
  };

  // アプリ終了時にトレイも破棄
  app.on('before-quit', () => {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  return createTray();
};

import { match } from 'ts-pattern';

import { syncLogsInBackground } from './module/logSync/service';

/**
 * 一定間隔でログ処理を実行するタイマーイベントを設定する。
 * バックグラウンド処理が有効な場合のみログを読み込み通知を送る。
 */
const setTimeEventEmitter = (
  passedSettingStore: ReturnType<typeof getSettingStore>,
) => {
  const intervalEventTarget = new EventTarget();
  // 6時間ごとに実行
  setInterval(
    () => {
      intervalEventTarget.dispatchEvent(
        new CustomEvent('time', { detail: new Date() }),
      );
    },
    1000 * 60 * 60 * 6,
  );

  intervalEventTarget.addEventListener('time', (event) => {
    const now = (event as CustomEvent<Date>).detail;
    void (async () => {
      if (!passedSettingStore.getBackgroundFileCreateFlag()) {
        // Use passedSettingStore
        logger.debug('バックグラウンド処理が無効になっています');
        return;
      }

      const either = await Effect.runPromise(
        Effect.either(syncLogsInBackground()),
      );

      if (either._tag === 'Left') {
        const error = either.left;
        const errorMessage = match(error)
          .with(
            { code: 'LOG_FILE_NOT_FOUND' },
            () => 'VRChatのログファイルが見つかりませんでした',
          )
          .with(
            { code: 'LOG_FILE_DIR_NOT_FOUND' },
            () => 'VRChatのログディレクトリが見つかりませんでした',
          )
          .with(
            { code: 'LOG_FILES_NOT_FOUND' },
            () => 'VRChatのログファイルが存在しません',
          )
          .with({ code: 'UNKNOWN' }, () => '不明なエラーが発生しました')
          .otherwise(() => '予期せぬエラーが発生しました');

        logger.error({ message: error });

        new Notification({
          title: `joinの記録に失敗しました: ${now.toString()}`,
          body: errorMessage,
        }).show();

        return;
      }

      const {
        createdVRChatPhotoPathModelList,
        createdWorldJoinLogModelList,
        createdPlayerJoinLogModelList,
      } = either.right;
      if (
        createdVRChatPhotoPathModelList.length === 0 &&
        createdWorldJoinLogModelList.length === 0 &&
        createdPlayerJoinLogModelList.length === 0
      ) {
        return;
      }

      const photoCount = createdVRChatPhotoPathModelList.length;
      const worldJoinCount = createdWorldJoinLogModelList.length;
      const playerJoinCount = createdPlayerJoinLogModelList.length;

      new Notification({
        title: `joinの記録に成功しました: ${now.toString()}`,
        body: `${photoCount}枚の新しい写真を記録しました\n${worldJoinCount}件のワールド参加を記録しました\n${playerJoinCount}件のプレイヤー参加を記録しました`,
      }).show();
    })();
  });
};

/**
 * メインウィンドウをリロードする。
 * ウィンドウが存在しない場合は何もしない。
 */
export const reloadMainWindow = (): void => {
  const window = getWindow();
  if (window) {
    window.reload();
  }
};

export { setTray, createOrGetWindow, setTimeEventEmitter };

/**
 * 他モジュールから設定ストアを利用できるよう初期化する。
 * main プロセス起動時に一度だけ呼び出されることを想定。
 */
export const initializeSettingStoreForUtil = (): void => {
  if (settingStore === null) {
    settingStore = getSettingStore();
    logger.info('SettingStore initialized for electronUtil.ts');
  }
};
