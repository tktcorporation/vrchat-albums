// Native
import EventEmitter from 'node:events';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// Packages
import {
  BrowserWindow,
  type Event,
  Menu,
  Notification,
  Tray,
  app,
  ipcMain,
  screen, // Ensure screen is imported
  shell,
} from 'electron';
import isDev from 'electron-is-dev';

import { logger } from './lib/logger';
// Local
import { type SettingStore, getSettingStore } from './module/settingStore'; // Import the type

let settingStore: SettingStore | null = null;

const WINDOW_CONFIG = {
  DEFAULT_WIDTH: 1024,
  DEFAULT_HEIGHT: 768,
  MIN_WIDTH: 800,
  MIN_HEIGHT: 600,
} as const;

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
  let x: number | undefined = undefined;
  let y: number | undefined = undefined;

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
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false, // セキュリティのため明示的に無効化
      contextIsolation: true, // セキュリティのため明示的に有効化
    },
  });

  // 開発環境の場合、DevToolsを開く
  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }

  const port = process.env.PORT || 3000;
  const url = isDev
    ? `http://localhost:${port}`
    : join(__dirname, '../src/out/index.html');

  // and load the index.html of the app.
  if (isDev) {
    mainWindow.loadURL(url);
  } else {
    mainWindow.loadFile(url);
  }

  // http or httpsのリンクをクリックしたときにデフォルトブラウザで開く
  const handleUrlOpen = (e: Event, url: string) => {
    if (url.match(/^http/)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  };
  mainWindow.webContents.on('will-navigate', handleUrlOpen);

  // For AppBar
  ipcMain.on('minimize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return;
    }
    win.isMinimized() ? win.restore() : win.minimize();
  });

  ipcMain.on('maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return;
    }
    win.isMaximized() ? win.restore() : win.maximize();
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
  const displayMetricsChangedHandler = () => {
    // ウィンドウが破棄されているかチェック
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    try {
      const currentBounds = mainWindow.getBounds();
      const currentDisplay = screen.getDisplayNearestPoint({
        x: currentBounds.x,
        y: currentBounds.y,
      });

      // ウィンドウが表示可能な領域に収まるように調整
      const adjustedBounds = {
        width: Math.min(currentBounds.width, currentDisplay.workAreaSize.width),
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
    } catch (error) {
      logger.error({
        message: `Display metrics changed handler error: ${JSON.stringify(
          error,
        )}`,
      });
    }
  };

  screen.on('display-metrics-changed', displayMetricsChangedHandler);

  // ウィンドウ破棄時にイベントリスナーを削除
  mainWindow.once('closed', () => {
    screen.removeListener(
      'display-metrics-changed',
      displayMetricsChangedHandler,
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
    if (tray !== null) return;

    const appPath = app.isPackaged
      ? process.resourcesPath
      : `${app.getAppPath()}`;
    const iconPath = join(appPath, 'assets', 'icons', '256x256.png');

    // アイコンパスの存在確認とログ出力
    try {
      await fs.access(iconPath);
      logger.info({ message: `トレイアイコンが見つかりました: ${iconPath}` });
    } catch {
      logger.error({ message: `トレイアイコンが見つかりません: ${iconPath}` });
      return;
    }

    try {
      tray = new Tray(iconPath);
      logger.info({ message: 'トレイの作成に成功しました' });
    } catch (error) {
      logger.error({
        message: `トレイの作成に失敗しました: ${JSON.stringify(error)}`,
      });
      return;
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'ウィンドウを表示',
        click: () => {
          const window = createOrGetWindow();
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'エラーログを開く',
        click: () => {
          const logPath = app.getPath('logs');
          shell.openPath(logPath);
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
        if (window.isMinimized()) window.restore();
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
  const intervalEventEmitter = new EventEmitter();
  // 6時間ごとに実行
  setInterval(
    () => {
      intervalEventEmitter.emit('time', new Date());
    },
    1000 * 60 * 60 * 6,
  );

  intervalEventEmitter.on('time', async (now: Date) => {
    if (!passedSettingStore.getBackgroundFileCreateFlag()) {
      // Use passedSettingStore
      logger.debug('バックグラウンド処理が無効になっています');
      return;
    }

    const result = await syncLogsInBackground();

    if (result.isErr()) {
      const error = result.error;
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
    } = result.value;
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
