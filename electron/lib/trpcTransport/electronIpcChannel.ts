/**
 * tRPC の通信路（`shared/trpcTransport.ts` の `MessageChannel`）を Electron の IPC で実装する。
 *
 * 画面 1 つ（webContents 1 つ）が表示している文書 1 つを 1 本の接続として扱う。
 * `serveTrpc` は通信路の中身を知らないので、殻を換えるときはこのファイルだけを
 * 別の実装に差し替える。
 *
 * Electron の `ipcMain` と `WebContents` は、この接続に要る操作だけを持つ型で受け取る。
 * 単体テストが Electron を起動せずに、偽物の ipcMain と webContents で接続の寿命を確かめるため。
 */
import type {
  MessageChannel,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { TRPC_IPC_CHANNEL } from './ipcChannelName';

/** 画面から届いたメッセージの送り主。Electron の `IpcMainEvent` のうち、送り主の判定に使う部分 */
interface IpcSender {
  readonly sender: unknown;
  readonly senderFrame: unknown;
}

type IpcListener = (event: IpcSender, message: unknown) => void;

/** Electron の `ipcMain` のうち、接続が使う部分 */
export interface IpcReceiver {
  on(channel: string, listener: IpcListener): unknown;
  removeListener(channel: string, listener: IpcListener): unknown;
}

/** Electron の `WebContents` のうち、接続が使う部分 */
export interface ConnectableWebContents {
  /** 送り主の判定で比べる、いま表示している文書の main frame */
  readonly mainFrame: unknown;
  isDestroyed(): boolean;
  send(channel: string, message: ServerMessage): void;
  on(event: 'did-navigate', listener: () => void): unknown;
  once(event: 'destroyed', listener: () => void): unknown;
}

/**
 * webContents 1 つとの通信路を作る。
 *
 * 受け取るのは、この webContents の main frame から届いたメッセージだけにする。
 * 他のウィンドウや iframe が同じチャンネルへ送っても、この接続の呼び出しにはならない。
 * 受信の型が `unknown` なのは、画面から届く値の形を `serveTrpc` がスキーマで確かめるまで
 * `ClientMessage` とみなせないため。
 */
const createWebContentsChannel = (
  webContents: ConnectableWebContents,
  ipcMain: IpcReceiver,
): MessageChannel<ServerMessage, unknown> => ({
  send: (message) => {
    // 画面を閉じた後に購読や遅い query の結果が届いても、送り先が無いので捨てる
    if (!webContents.isDestroyed()) {
      webContents.send(TRPC_IPC_CHANNEL, message);
    }
  },
  onMessage: (listener) => {
    const onIpcMessage: IpcListener = (event, message) => {
      if (
        event.sender !== webContents ||
        event.senderFrame !== webContents.mainFrame
      ) {
        return;
      }
      listener(message);
    };
    ipcMain.on(TRPC_IPC_CHANNEL, onIpcMessage);
    return () => {
      ipcMain.removeListener(TRPC_IPC_CHANNEL, onIpcMessage);
    };
  },
});

/**
 * webContents の表示している文書 1 つを 1 本の接続とし、文書ごとに `connect` を呼ぶ。
 *
 * つなぎ直すのは、main frame に新しい文書が読み込まれたとき（`did-navigate`）だけにする。
 * `did-navigate` は再読み込みと別のページへの移動で発火し、同じ文書の中の移動
 * （`did-navigate-in-page`）や、`will-navigate` で取り消された移動では発火しない。
 * 移動が始まった時点でつなぎ直すと、ファイルのドロップのように取り消される移動でも
 * 前の文書の購読が止まり、届くはずの応答が捨てられる。
 * 新しい文書が読み込まれたら、前の文書の購読を止める。前の文書の画面はもう無く、
 * 購読を残すとイベントのたびに届かない送信が続くため。
 *
 * webContents が破棄されたら接続を閉じる。
 *
 * @param connect 通信路を受け取って接続を始め、接続を閉じる関数を返す（`serveTrpc`）
 * @param ipcMain 画面からのメッセージを受け取る口。Electron では `ipcMain`
 */
export const serveOverElectronIpc = (
  webContents: ConnectableWebContents,
  connect: (channel: MessageChannel<ServerMessage, unknown>) => () => void,
  ipcMain: IpcReceiver,
): void => {
  let disconnect = connect(createWebContentsChannel(webContents, ipcMain));

  webContents.on('did-navigate', () => {
    disconnect();
    disconnect = connect(createWebContentsChannel(webContents, ipcMain));
  });
  webContents.once('destroyed', () => {
    disconnect();
  });
};
