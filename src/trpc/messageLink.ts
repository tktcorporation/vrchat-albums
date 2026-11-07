/**
 * tRPC の呼び出しを、通信路（`shared/trpcTransport.ts` の `MessageChannel`）へ流す link。
 *
 * 通信路が何でできているかは知らない。処理本体側の受け口
 * （`electron/lib/trpcTransport/serveTrpc.ts`）と同じメッセージを送り合うだけなので、
 * 殻を換えるときは渡す `channel` を差し替えればよい。
 */
import { type Operation, TRPCClientError, type TRPCLink } from '@trpc/client';
import {
  getTransformer,
  type TransformerOptions,
} from '@trpc/client/unstable-internals';
import type { AnyTRPCRouter, inferTRPCClientTypes } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { match } from 'ts-pattern';

import type {
  ClientMessage,
  MessageChannel,
  OperationId,
  ServerMessage,
} from '../../shared/trpcTransport';

export type MessageLinkOptions<TRouter extends AnyTRPCRouter> = {
  /**
   * 画面側の通信路。最初の呼び出しまで受信を登録しないので、通信路が無い環境
   * （preload の無いテストやブラウザ）でも link を作るだけなら失敗しない。
   */
  channel: MessageChannel<ClientMessage, ServerMessage>;
} & TransformerOptions<inferTRPCClientTypes<TRouter>>;

/**
 * クライアントごとの ID の接頭辞を作る。
 *
 * 呼び出しの ID は接頭辞と連番をつなげたもの。同じ通信路に複数のクライアントが
 * つながっても（別のクライアントの連番が同じでも）、接頭辞が違うので応答が混ざらない。
 * `crypto.randomUUID` は secure context でしか使えないため、どの文書でも使える
 * `getRandomValues` で作る。
 */
const createClientPrefix = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

/**
 * 通信路の上で tRPC の呼び出しを行う link を作る。
 *
 * query / mutation は data か error を 1 つ受けて終わる。subscription は complete か
 * error を受けるまで data を流し、購読をやめると stop を送る。
 */
export const messageLink = <TRouter extends AnyTRPCRouter>(
  opts: MessageLinkOptions<TRouter>,
): TRPCLink<TRouter> => {
  return () => {
    const { channel } = opts;
    const transformer = getTransformer(opts.transformer);
    const prefix = createClientPrefix();
    let counter = 0;
    /** 応答を待っている呼び出し。ID で受信したメッセージを振り分ける */
    const pending = new Map<OperationId, (message: ServerMessage) => void>();
    let listening = false;

    const listen = () => {
      if (listening) {
        return;
      }
      listening = true;
      channel.onMessage((message) => {
        // 別のクライアントの呼び出しと、やめた呼び出しへの応答はここで捨てる
        pending.get(message.id)?.(message);
      });
    };

    return ({ op }: { op: Operation }) =>
      observable((observer) => {
        listen();
        counter += 1;
        const id: OperationId = `${prefix}:${counter}`;

        pending.set(id, (message) => {
          match(message)
            .with({ kind: 'data' }, ({ data }) => {
              const deserialized: unknown =
                transformer.output.deserialize(data);
              observer.next({ result: { type: 'data', data: deserialized } });
              if (op.type !== 'subscription') {
                pending.delete(id);
                observer.complete();
              }
            })
            .with({ kind: 'error' }, ({ error }) => {
              pending.delete(id);
              const shape: unknown = transformer.output.deserialize(error);
              // HTTP や WebSocket の link と同じく、応答全体を渡して TRPCClientError に戻す。
              // error.data（errorFormatter が足した structuredError など）はこの形で残る
              observer.error(
                TRPCClientError.from({
                  id,
                  error: shape,
                }),
              );
            })
            .with({ kind: 'complete' }, () => {
              pending.delete(id);
              observer.complete();
            })
            .exhaustive();
        });

        channel.send({
          kind: 'call',
          id,
          type: op.type,
          path: op.path,
          input: transformer.input.serialize(op.input),
        });

        return () => {
          // 応答の前にやめた呼び出し。subscription だけは処理本体側でも止める必要がある
          if (pending.delete(id) && op.type === 'subscription') {
            channel.send({ kind: 'stop', id });
          }
        };
      });
  };
};
