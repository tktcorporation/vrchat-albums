/**
 * tRPC の通信路（`shared/trpcTransport.ts` の `MessageChannel`）を Electron の IPC で実装する。
 *
 * 画面 1 つ（webContents 1 つ）を 1 本の接続として扱う。`serveTrpc` は通信路の中身を
 * 知らないので、殻を換えるときはこのファイルだけを別の実装に差し替える。
 */
import type { IpcMainEvent, WebContents } from 'electron';

import type {
  MessageChannel,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { getIpcMain } from '../electronModules';
import { TRPC_IPC_CHANNEL } from './ipcChannelName';

/**
 * webContents 1 つとの通信路を作る。
 *
 * 受け取るのは、この webContents の main frame から届いたメッセージだけにする。
 * 他のウィンドウや iframe が同じチャンネルへ送っても、この接続の呼び出しにはならない。
 * 受信の型が `unknown` なのは、画面から届く値の形を `serveTrpc` がスキーマで確かめるまで
 * `ClientMessage` とみなせないため。
 */
const createWebContentsChannel = (
  webContents: WebContents,
): MessageChannel<ServerMessage, unknown> => ({
  send: (message) => {
    // 画面を閉じた後に購読や遅い query の結果が届いても、送り先が無いので捨てる
    if (!webContents.isDestroyed()) {
      webContents.send(TRPC_IPC_CHANNEL, message);
    }
  },
  onMessage: (listener) => {
    const onIpcMessage = (event: IpcMainEvent, message: unknown) => {
      if (
        event.sender !== webContents ||
        event.senderFrame !== webContents.mainFrame
      ) {
        return;
      }
      listener(message);
    };
    const ipcMain = getIpcMain();
    ipcMain.on(TRPC_IPC_CHANNEL, onIpcMessage);
    return () => {
      ipcMain.removeListener(TRPC_IPC_CHANNEL, onIpcMessage);
    };
  },
});

/**
 * webContents の表示している文書 1 つを 1 本の接続とし、文書ごとに `connect` を呼ぶ。
 *
 * 再読み込みや別のページへの移動で文書が入れ替わると、前の文書の購読を止めて
 * つなぎ直す。前の文書の画面はもう無く、購読を残すとイベントのたびに届かない送信が続くため。
 * webContents が破棄されたら接続を閉じる。
 *
 * @param connect 通信路を受け取って接続を始め、接続を閉じる関数を返す（`serveTrpc`）
 */
export const serveOverElectronIpc = (
  webContents: WebContents,
  connect: (channel: MessageChannel<ServerMessage, unknown>) => () => void,
): void => {
  let disconnect = connect(createWebContentsChannel(webContents));

  webContents.on('did-start-navigation', (details) => {
    if (details.isSameDocument || !details.isMainFrame) {
      return;
    }
    disconnect();
    disconnect = connect(createWebContentsChannel(webContents));
  });
  webContents.once('destroyed', () => {
    disconnect();
  });
};
