/**
 * 画面（renderer）と処理本体の間で tRPC を運ぶ仕組みの、main プロセス側の唯一の入口。
 *
 * 処理本体（tRPC の router・サービス・DB）は utilityProcess で動き、main はウィンドウと OS の操作だけを持つ。
 * 画面と処理本体は MessagePort で直接つながり、main は文書ごとに port の組を作って両側へ配るだけで、
 * tRPC のメッセージそのものは中継しない。処理本体で重い処理が走っても、main のウィンドウ操作は止まらない。
 *
 * 通信の仕組みは、プロセスごとに 1 つずつある入口と、その間の取り決めでできている。
 *
 * | プロセス           | 入口                                         | 中身（入口の外からは読まない）                                   |
 * | ------------------ | -------------------------------------------- | ---------------------------------------------------------------- |
 * | main               | このファイルの `startTrpcBroker`             | `./ipcChannelName.ts`                                            |
 * | 処理本体（utility） | `./backend.ts` の `serveTrpcOnPort`          | `./serveTrpc.ts`                                                 |
 * | preload            | `./preload.ts` の `exposeTrpcBridge`         | `./portBridge.ts`・`./ipcChannelName.ts`                         |
 * | 画面               | `src/trpc.ts` の `trpcClient`・`trpcReact`   | `src/trpc/messageLink.ts`・`src/trpc/electronRendererChannel.ts` |
 *
 * 文書 1 つにつき接続は 1 本で、次の順につながる。
 * 1. preload が読み込まれると、main へ port を頼む（`TRPC_PORT_REQUEST_CHANNEL`）
 * 2. main は MessageChannelMain を作り、片方に接続 ID を付けて処理本体へ、もう片方を preload へ渡す。
 *    同じ webContents の前の文書の接続は、処理本体に閉じさせる
 * 3. preload は port が届くまで画面の送信を貯め、届いたら port の上で送受信する
 * 4. 処理本体は port ごとに `serveTrpc` を動かし、port が切れたら購読を止める
 *
 * 処理本体を起動し直したときは、main がすべてのウィンドウを再読み込みし、1 からつなぎ直す。
 * main と処理本体の間の、tRPC 以外の取り決め（起動・終了・OS の操作の依頼）は `electron/lib/backendProcess/` にある。
 *
 * メッセージの形は `shared/trpcTransport.ts` が決める。中身を入口の外から読まないことは ast-grep の
 * `trpc-transport-internal-import` と `renderer-trpc-internal-import` が検出する。
 *
 * 殻を MessagePort 以外（WebSocket・別の土台の RPC）に換えるときに書き換えるのは、通信路の実装だけになる。
 * main はこのファイル、処理本体は `./backend.ts`、preload は `./preload.ts`・`./portBridge.ts`
 * （preload が要らない殻なら削除する）、画面側は `src/trpc/electronRendererChannel.ts` を差し替える。
 * `./serveTrpc.ts` と `src/trpc/messageLink.ts` は通信路の中身を知らないので、殻を換えても変えない。
 * router と procedure（`electron/api.ts`）、画面の呼び出し側も変えない。
 */
import { randomUUID } from 'node:crypto';

import { getIpcMain, getMessageChannelMain } from '../electronModules';
import { TRPC_PORT_CHANNEL, TRPC_PORT_REQUEST_CHANNEL } from './ipcChannelName';

/** Electron の `WebContents` のうち、port の配布に使う部分 */
export interface BrokeredWebContents<TPort> {
  /** 送り主の判定で比べる、いま表示している文書の main frame */
  readonly mainFrame: unknown;
  isDestroyed(): boolean;
  postMessage(channel: string, message: null, transfer: TPort[]): void;
  once(event: 'destroyed', listener: () => void): unknown;
}

/** preload からの依頼。Electron の `IpcMainEvent` のうち、送り主の判定と返信に使う部分 */
interface PortRequestEvent<TPort> {
  readonly sender: BrokeredWebContents<TPort>;
  readonly senderFrame: unknown;
}

type PortRequestListener<TPort> = (event: PortRequestEvent<TPort>) => void;

/**
 * 接続に使う Electron の部品。
 *
 * 単体テストが Electron を起動せずに、偽物の ipcMain と MessageChannelMain で
 * 文書ごとの配布を確かめるために受け取れるようにしている。
 */
export interface BrokerShell<TPort> {
  readonly ipcMain: {
    on(channel: string, listener: PortRequestListener<TPort>): unknown;
    removeListener(
      channel: string,
      listener: PortRequestListener<TPort>,
    ): unknown;
  };
  createChannel(): { readonly port1: TPort; readonly port2: TPort };
}

/** 接続を受け持つ処理本体。main の `electron/lib/backendProcess/supervisor.ts` が実装する */
export interface TrpcBackend<TPort> {
  /** 処理本体へ port を渡し、その上で tRPC を待ち受けさせる */
  connect(connectionId: string, port: TPort): void;
  /** 前の文書の接続を閉じさせる */
  disconnect(connectionId: string): void;
}

/**
 * preload からの依頼に応え、文書ごとに処理本体との接続を配る。
 *
 * 依頼を受けてから port を渡すのは、preload が port を受け取る準備を済ませた後に届けるため。
 * ウィンドウの作成や `did-navigate` の時点で送ると、preload がまだ動いていない文書へ送って取りこぼしうる。
 * 受け付けるのは、webContents の main frame からの依頼だけにする。iframe が頼んでも処理本体へつながない。
 *
 * ipcMain はアプリの起動直後から使えるので、最初のウィンドウを作るより前に呼ぶ。
 *
 * @param shell 接続に使う Electron の部品。省くと実際の `ipcMain` と `MessageChannelMain` を使う
 * @returns 依頼の受け付けをやめ、配った接続をすべて閉じさせる関数
 */
export const startTrpcBroker = <TPort>(
  { backend }: { readonly backend: TrpcBackend<TPort> },
  shell?: BrokerShell<TPort>,
): (() => void) => {
  const { ipcMain, createChannel } =
    shell ??
    // 実際の Electron の部品は、型引数の TPort を MessagePortMain として扱う
    ({
      ipcMain: getIpcMain(),
      createChannel: () => new (getMessageChannelMain())(),
    } as unknown as BrokerShell<TPort>);
  const connections = new Map<BrokeredWebContents<TPort>, string>();

  const onPortRequest: PortRequestListener<TPort> = (event) => {
    const webContents = event.sender;
    if (
      webContents.isDestroyed() ||
      event.senderFrame !== webContents.mainFrame
    ) {
      return;
    }
    const previous = connections.get(webContents);
    if (previous === undefined) {
      webContents.once('destroyed', () => {
        const current = connections.get(webContents);
        if (current !== undefined) {
          backend.disconnect(current);
          connections.delete(webContents);
        }
      });
    } else {
      backend.disconnect(previous);
    }

    const connectionId = randomUUID();
    const { port1, port2 } = createChannel();
    connections.set(webContents, connectionId);
    backend.connect(connectionId, port1);
    webContents.postMessage(TRPC_PORT_CHANNEL, null, [port2]);
  };
  ipcMain.on(TRPC_PORT_REQUEST_CHANNEL, onPortRequest);

  return () => {
    ipcMain.removeListener(TRPC_PORT_REQUEST_CHANNEL, onPortRequest);
    for (const connectionId of connections.values()) {
      backend.disconnect(connectionId);
    }
    connections.clear();
  };
};
