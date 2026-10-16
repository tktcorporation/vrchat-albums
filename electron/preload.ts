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
      ipcRenderer.on(
        ELECTRON_TRPC_CHANNEL,
        (_event, args: TRPCResponseMessage) => callback(args),
      ),
  };
  contextBridge.exposeInMainWorld('electronTRPC', electronTRPC);
};
/**
 * ウィンドウ操作ボタン（AppHeader）用の API。
 * レンダラに任意の IPC 送受信を許さないよう、送信先チャンネルを固定した関数だけを公開する。
 * 受け手は electron/electronUtil.ts の ipcMain.on('minimize' | 'maximize' | 'close')。
 */
const windowControls = {
  Minimize: () => {
    ipcRenderer.send('minimize');
  },
  Maximize: () => {
    ipcRenderer.send('maximize');
  },
  Close: () => {
    ipcRenderer.send('close');
  },
};
contextBridge.exposeInMainWorld('Main', windowControls);

declare global {
  interface Window {
    /** preload が無いブラウザ実行時は未定義になる */
    Main?: typeof windowControls;
  }
}

process.once('loaded', () => {
  exposeElectronTRPC();
});
