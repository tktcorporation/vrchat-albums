/**
 * tRPC の通信路の、preload 側の唯一の入口（全体の構成は `./index.ts`）。
 *
 * preload は sandbox 内で単一ファイルにバンドルされるので、ここからは型と
 * チャンネル名の定数（`./ipcChannelName.ts`）だけを読み込み、スキーマの検証や
 * tRPC のサーバー側の部品をバンドルに巻き込まない。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  ClientMessage,
  MessageChannel,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { TRPC_IPC_CHANNEL } from './ipcChannelName';

/**
 * 画面へ公開する通信路（`shared/trpcTransport.ts` の `MessageChannel`）。
 * 画面側は `src/trpc/electronRendererChannel.ts` がこれを使い、受け手は `./electronIpcChannel.ts`。
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

declare global {
  interface Window {
    /** preload が無いブラウザ実行時は未定義になる */
    electronTRPC?: typeof electronTRPC;
  }
}

/** 通信路を `window.electronTRPC` として画面へ公開する。preload の読み込み時に 1 回呼ぶ */
export const exposeTrpcBridge = (): void => {
  process.once('loaded', () => {
    contextBridge.exposeInMainWorld('electronTRPC', electronTRPC);
  });
};
