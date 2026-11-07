/**
 * Electron の preload スクリプト。
 * Sentry の IPC 連携を有効化するため、`@sentry/electron/preload` を読み込む。
 */
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  ClientMessage,
  MessageChannel,
  ServerMessage,
} from '../shared/trpcTransport';
import { TRPC_IPC_CHANNEL } from './lib/trpcTransport/ipcChannelName';

/**
 * tRPC のメッセージを運ぶ通信路（`shared/trpcTransport.ts`）。
 * 画面側の link（`src/trpc/messageLink.ts`）が使い、受け手は
 * electron/lib/trpcTransport/electronIpcChannel.ts。
 * 送受信とも固定の 1 チャンネルだけを使い、画面に任意の IPC を許さない。
 * 送った中身は処理本体側がスキーマで確かめる。
 */
const electronTRPC: MessageChannel<ClientMessage, ServerMessage> = {
  send: (message) => {
    ipcRenderer.send(TRPC_IPC_CHANNEL, message);
  },
  onMessage: (listener) => {
    const onIpcMessage = (_event: IpcRendererEvent, message: ServerMessage) => {
      listener(message);
    };
    ipcRenderer.on(TRPC_IPC_CHANNEL, onIpcMessage);
    return () => {
      ipcRenderer.removeListener(TRPC_IPC_CHANNEL, onIpcMessage);
    };
  },
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
    /** preload が無いブラウザ実行時は未定義になる */
    electronTRPC?: typeof electronTRPC;
  }
}

process.once('loaded', () => {
  contextBridge.exposeInMainWorld('electronTRPC', electronTRPC);
});
