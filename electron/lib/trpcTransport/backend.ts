/**
 * tRPC の通信路の、処理本体（utilityProcess）側の唯一の入口（全体の構成は `./index.ts`）。
 *
 * main は画面の文書 1 つにつき MessageChannelMain を 1 本作り、片方の port を処理本体へ、
 * もう片方を preload へ渡す。処理本体は受け取った port 1 本を 1 本の接続として、
 * その上で router を呼び出せるようにする（`./serveTrpc.ts`）。
 *
 * Electron の `MessagePortMain` は、この接続に要る操作だけを持つ型で受け取る。
 * 単体テストが Electron を起動せずに、偽物の port で接続の寿命を確かめるため。
 */
import type { AnyTRPCRouter, inferRouterContext } from '@trpc/server';

import type {
  MessageChannel,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { serveTrpc } from './serveTrpc';

/** Electron の `MessagePortMain` のうち、接続が使う部分 */
export interface ServerPort {
  on(
    event: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): unknown;
  on(event: 'close', listener: () => void): unknown;
  removeListener(
    event: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): unknown;
  postMessage(message: ServerMessage): void;
  start(): void;
  close(): void;
}

interface ServeTrpcOnPortOptions<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  /** 呼び出しごとに procedure へ渡す ctx を作る */
  createContext: () =>
    | inferRouterContext<TRouter>
    | Promise<inferRouterContext<TRouter>>;
}

/**
 * port 1 本の上で router を呼び出せるようにする。
 *
 * 画面の文書が閉じられる（再読み込み・ウィンドウの破棄）と、Electron は相手側の port の
 * 切断を `close` で知らせる。そのときに接続を閉じ、購読を止める。
 * 受け取る値の型が `unknown` なのは、画面から届く値を `serveTrpc` がスキーマで確かめるまで
 * `ClientMessage` とみなせないため。
 *
 * @returns 接続を閉じ、port も閉じる関数。何度呼んでもよい
 */
export const serveTrpcOnPort = <TRouter extends AnyTRPCRouter>(
  port: ServerPort,
  { router, createContext }: ServeTrpcOnPortOptions<TRouter>,
): (() => void) => {
  let closed = false;
  const channel: MessageChannel<ServerMessage, unknown> = {
    send: (message) => {
      // 文書が閉じた後に購読や遅い query の結果が届いても、送り先が無いので捨てる
      if (!closed) {
        port.postMessage(message);
      }
    },
    onMessage: (listener) => {
      const onPortMessage = (event: { readonly data: unknown }) => {
        listener(event.data);
      };
      port.on('message', onPortMessage);
      return () => {
        port.removeListener('message', onPortMessage);
      };
    },
  };
  const stopServing = serveTrpc({ router, createContext, channel });

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    stopServing();
    port.close();
  };
  port.on('close', close);
  port.start();
  return close;
};
