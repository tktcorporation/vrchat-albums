/**
 * 画面（renderer）と処理本体の間で tRPC を運ぶ通信路の取り決め。
 *
 * tRPC の link（`src/trpc/messageLink.ts`）とサーバー側の受け口
 * （`electron/lib/trpcTransport/`）は、この型のメッセージを送り合うだけで、
 * 通信路が何でできているかを知らない。Electron の IPC はこの通信路の実装の 1 つで、
 * 殻を換えるときは実装（MessagePort・WebSocket・別の土台の RPC）を差し替える（#899）。
 *
 * メッセージの中身（input と結果）は tRPC の transformer（superjson）で
 * 直列化した後の値で、通信路は構造化複製できる値として運べばよい。
 */

/**
 * 1 つの呼び出しを識別する ID。
 *
 * クライアントごとに作る接頭辞と連番をつなげるので、同じ通信路に複数の
 * クライアントがつながっても、応答が別のクライアントの呼び出しに届かない。
 */
export type OperationId = string;

export type OperationType = 'query' | 'mutation' | 'subscription';

/** 画面から処理本体へ送るメッセージ */
export type ClientMessage =
  | {
      readonly kind: 'call';
      readonly id: OperationId;
      readonly type: OperationType;
      readonly path: string;
      /** transformer で直列化した input */
      readonly input: unknown;
    }
  | {
      /** subscription の購読をやめる。query / mutation には使わない */
      readonly kind: 'stop';
      readonly id: OperationId;
    };

/** 処理本体から画面へ返すメッセージ */
export type ServerMessage =
  | {
      /** query / mutation の結果、または subscription の 1 件分のデータ */
      readonly kind: 'data';
      readonly id: OperationId;
      /** transformer で直列化した結果 */
      readonly data: unknown;
    }
  | {
      /**
       * 呼び出しの失敗。errorFormatter（`electron/trpc.ts`）で整形した後の形を
       * transformer で直列化したもの。受け取った link が TRPCClientError に戻す。
       */
      readonly kind: 'error';
      readonly id: OperationId;
      readonly error: unknown;
    }
  | {
      /** subscription の終わり。サーバーが終えた場合と stop を受けた場合の両方で送る */
      readonly kind: 'complete';
      readonly id: OperationId;
    };

/**
 * メッセージを送り、届いたメッセージを受け取るだけの通信路。
 *
 * 画面側は `MessageChannel<ClientMessage, ServerMessage>` を持つ。処理本体側は
 * 接続ごとに `MessageChannel<ServerMessage, unknown>` を持つ。画面から届く値は
 * 信用できない入力なので、受け口（`serveTrpc`）が `ClientMessage` として検証してから使う。
 */
export interface MessageChannel<Outgoing, Incoming> {
  send(message: Outgoing): void;
  /** 受信の登録を返す。呼ぶと受信をやめる */
  onMessage(listener: (message: Incoming) => void): () => void;
}
