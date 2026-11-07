/**
 * Electron の preload スクリプト。
 * Sentry の IPC 連携を有効化するため、`@sentry/electron/preload` を読み込む。
 */
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer } from 'electron';

import { exposeTrpcBridge } from './lib/trpcTransport/preload';

exposeTrpcBridge();

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
