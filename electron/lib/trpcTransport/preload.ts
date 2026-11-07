/**
 * tRPC の通信路の、preload 側の唯一の入口（全体の構成は `./index.ts`）。
 *
 * preload は sandbox 内で単一ファイルにバンドルされるので、ここからは型と
 * チャンネル名の定数（`./ipcChannelName.ts`）、port の上の通信路（`./portBridge.ts`）だけを読み込み、
 * スキーマの検証や tRPC のサーバー側の部品をバンドルに巻き込まない。
 */
import { contextBridge, ipcRenderer } from 'electron';

import { type BridgePort, createPortBridge } from './portBridge';

/**
 * 画面へ公開する通信路（`shared/trpcTransport.ts` の `MessageChannel`）。
 * 画面側は `src/trpc/electronRendererChannel.ts` がこれを使う。メッセージは main が渡した
 * MessagePort で処理本体へ直接届き、処理本体がスキーマで確かめる。
 */
const createElectronTrpcBridge = () =>
  createPortBridge({
    send: (channel) => {
      ipcRenderer.send(channel);
    },
    on: (channel, listener) =>
      ipcRenderer.on(channel, (event) => {
        // preload の世界の MessagePort は DOM の MessagePort で、BridgePort の操作をすべて持つ
        listener({ ports: event.ports as BridgePort[] });
      }),
  });

declare global {
  interface Window {
    /** preload が無いブラウザ実行時は未定義になる */
    electronTRPC?: ReturnType<typeof createElectronTrpcBridge>;
  }
}

/** 通信路を `window.electronTRPC` として画面へ公開する。preload の読み込み時に 1 回呼ぶ */
export const exposeTrpcBridge = (): void => {
  const electronTRPC = createElectronTrpcBridge();
  process.once('loaded', () => {
    contextBridge.exposeInMainWorld('electronTRPC', electronTRPC);
  });
};
