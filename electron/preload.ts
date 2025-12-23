import '@sentry/electron/preload';

import type { Operation } from '@trpc/client';
import type { TRPCResponseMessage } from '@trpc/server/rpc';
/**
 * Electron の preload スクリプト。
 * Sentry の IPC 連携を有効化するため、`@sentry/electron/preload` を読み込む。
 */
import { contextBridge, ipcRenderer } from 'electron';

type ETRPCRequest =
  | { method: 'request'; operation: Operation }
  | { method: 'subscription.stop'; id: number };

interface RendererGlobalElectronTRPC {
  sendMessage: (args: ETRPCRequest) => void;
  onMessage: (callback: (args: TRPCResponseMessage) => void) => void;
}

const ELECTRON_TRPC_CHANNEL = 'trpc-electron';

/**
 * tRPC 用の IPC チャンネルをレンダラに公開するヘルパー。
 * preload スクリプトの `loaded` イベントで呼び出される。
 */
const exposeElectronTRPC = () => {
  const electronTRPC: RendererGlobalElectronTRPC = {
    sendMessage: (operation) =>
      ipcRenderer.send(ELECTRON_TRPC_CHANNEL, operation),
    onMessage: (callback) =>
      ipcRenderer.on(ELECTRON_TRPC_CHANNEL, (_event, args) => callback(args)),
  };
  contextBridge.exposeInMainWorld('electronTRPC', electronTRPC);
};
process.once('loaded', () => {
  exposeElectronTRPC();
  // If you expose something here, you get window.something in the React app
  // type it in types/exposedInMainWorld.d.ts to add it to the window type
  // contextBridge.exposeInMainWorld("something", {
  //   exposedThing: "this value was exposed via the preload file",
  // });
});
declare global {
  interface Window {
    Main: typeof api;
    MyOn: typeof myOn;
    ipcRenderer: typeof ipcRenderer;
  }
}

const api = {
  /**
   * Here you can expose functions to the renderer process
   * so they can interact with the main (electron) side
   * without security problems.
   *
   * The function below can accessed using `window.Main.sayHello`
   */
  sendErrorMessage: (message: string) => {
    ipcRenderer.send('error-message', message);
  },
  setLogFilePath: (path: string) => {
    ipcRenderer.send('set-log-file-path', path);
  },
  openDialogAndSetLogFilesDir: () => {
    ipcRenderer.send('open-dialog-and-set-log-files-dir');
  },
  getLogFilesDir: () => {
    ipcRenderer.send('get-log-files-dir');
  },
  openDialogAndSetVRChatPhotoDir: () => {
    ipcRenderer.send('open-dialog-and-set-vrchat-photo-dir');
  },
  getVRChatPhotoDir: () => {
    ipcRenderer.send('get-vrchat-photo-dir');
  },
  getStatusToUseVRChatLogFilesDir: () => {
    ipcRenderer.send('get-status-to-use-vrchat-log-files-dir');
  },
  createFiles: () => {
    ipcRenderer.send('create-files');
  },
  /**
    Here function for AppBar
   */
  Minimize: () => {
    ipcRenderer.send('minimize');
  },
  Maximize: () => {
    ipcRenderer.send('maximize');
  },
  Close: () => {
    ipcRenderer.send('close');
  },
  /**
   * Provide an easier way to listen to events
   */
  on: (channel: string, callback: (data: unknown) => void) => {
    ipcRenderer.on(channel, (_, data) => callback(data));
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
};
contextBridge.exposeInMainWorld('Main', api);

/**
 * 型安全な ipcRenderer.on
 */
const myOn = {
  receiveStatusToUseVRChatLogFilesDir: (
    callback: (
      data:
        | 'ready'
        | 'logFilesDirNotSet'
        | 'logFilesNotFound'
        | 'logFileDirNotFound',
    ) => void,
  ) => {
    const key = 'status-to-use-vrchat-log-files-dir';
    ipcRenderer.on(key, (_, data) => callback(data));
    return () => {
      ipcRenderer.removeAllListeners(key);
    };
  },
  receiveVRChatPhotoDirWithError: (
    callback: (data: {
      storedPath: string | null;
      path: string;
      error: null | 'photoYearMonthDirsNotFound' | 'photoDirReadError';
    }) => void,
  ) => {
    const key = 'vrchat-photo-dir-with-error';
    ipcRenderer.on(key, (_, data) => callback(data));
    return () => {
      ipcRenderer.removeAllListeners(key);
    };
  },
};
contextBridge.exposeInMainWorld('MyOn', myOn);

/**
 * Using the ipcRenderer directly in the browser through the contextBridge ist not really secure.
 * I advise using the Main/api way !!
 */
contextBridge.exposeInMainWorld('ipcRenderer', ipcRenderer);
