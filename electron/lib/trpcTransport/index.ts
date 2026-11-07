/**
 * 画面（renderer）と処理本体の間で tRPC を運ぶ仕組みの、処理本体側の唯一の入口。
 *
 * 通信の仕組みは、プロセスごとに 1 つずつある入口と、その間の取り決めでできている。
 *
 * | プロセス | 入口                                                      | 中身（入口の外からは読まない）                         |
 * | -------- | --------------------------------------------------------- | ------------------------------------------------------ |
 * | 処理本体 | このファイルの `startTrpcServer`                          | `./serveTrpc.ts`・`./electronIpcChannel.ts`            |
 * | preload  | `./preload.ts` の `exposeTrpcBridge`                      | `./ipcChannelName.ts`                                  |
 * | 画面     | `src/trpc.ts` の `trpcClient`・`trpcReact`                | `src/trpc/messageLink.ts`・`src/trpc/electronRendererChannel.ts` |
 *
 * 3 つの入口が送り合うメッセージの形は `shared/trpcTransport.ts` が決める。
 * 中身を入口の外から読まないことは ast-grep の `trpc-transport-internal-import` と
 * `renderer-trpc-internal-import` が検出する。
 *
 * 殻（Electron の IPC）を MessagePort・WebSocket・別の土台の RPC に換えるときに書き換えるのは、
 * 通信路の実装だけになる。処理本体側はこのファイルと `./electronIpcChannel.ts`、
 * preload は `./preload.ts`（preload が要らない殻なら削除する）、画面側は
 * `src/trpc/electronRendererChannel.ts` を差し替える。`./serveTrpc.ts` と
 * `src/trpc/messageLink.ts` は通信路の中身を知らないので、殻を換えても変えない。
 * router と procedure（`electron/api.ts`）、画面の呼び出し側も変えない。
 */
import type { AnyTRPCRouter, inferRouterContext } from '@trpc/server';

import { getApp, getIpcMain } from '../electronModules';
import {
  type ConnectableWebContents,
  type IpcReceiver,
  serveOverElectronIpc,
} from './electronIpcChannel';
import { serveTrpc } from './serveTrpc';

type WindowCreatedListener = (
  event: unknown,
  window: { readonly webContents: ConnectableWebContents },
) => void;

/** Electron の `app` のうち、ウィンドウの作成を知るために使う部分 */
interface WindowSource {
  on(event: 'browser-window-created', listener: WindowCreatedListener): unknown;
  removeListener(
    event: 'browser-window-created',
    listener: WindowCreatedListener,
  ): unknown;
}

/**
 * 接続に使う Electron の部品。
 *
 * 単体テストが Electron を起動せずに、偽物の app と ipcMain で
 * ウィンドウごとの接続を確かめるために受け取れるようにしている。
 */
interface ElectronShell {
  readonly app: WindowSource;
  readonly ipcMain: IpcReceiver;
}

interface StartTrpcServerOptions<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  /** 呼び出しごとに procedure へ渡す ctx を作る */
  createContext: () =>
    | inferRouterContext<TRouter>
    | Promise<inferRouterContext<TRouter>>;
}

/**
 * これから作られるウィンドウのそれぞれと、router を呼び出せる接続を張る。
 *
 * 接続はウィンドウごとに張る。トレイや二重起動から開き直したウィンドウは
 * 新しい webContents を持つので、最初のウィンドウだけにつなぐと応答が届かない。
 * `browser-window-created` は BrowserWindow のコンストラクタの中で同期的に発火し、
 * 画面を読み込むより先に届くので、画面が送り始める前に接続できる。
 * そのため、最初のウィンドウを作るより前に呼ぶ。
 *
 * @param shell 接続に使う Electron の部品。省くと実際の `app` と `ipcMain` を使う
 * @returns 新しいウィンドウへの接続をやめ、張った接続をすべて閉じる関数
 */
export const startTrpcServer = <TRouter extends AnyTRPCRouter>(
  { router, createContext }: StartTrpcServerOptions<TRouter>,
  shell?: ElectronShell,
): (() => void) => {
  const { app, ipcMain } = shell ?? { app: getApp(), ipcMain: getIpcMain() };
  const closers = new Set<() => void>();

  const onWindowCreated: WindowCreatedListener = (_event, window) => {
    const close = serveOverElectronIpc(
      window.webContents,
      (channel) => serveTrpc({ router, createContext, channel }),
      ipcMain,
    );
    closers.add(close);
    // 破棄されたウィンドウの接続は serveOverElectronIpc が閉じるので、止めるときに閉じ直さない
    window.webContents.once('destroyed', () => {
      closers.delete(close);
    });
  };
  app.on('browser-window-created', onWindowCreated);

  return () => {
    app.removeListener('browser-window-created', onWindowCreated);
    for (const close of closers) {
      close();
    }
    closers.clear();
  };
};
