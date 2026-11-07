/**
 * 通信路 1 本（= 画面 1 つとの接続）の上で tRPC の router を呼び出せるようにする受け口。
 *
 * 通信路が何でできているか（Electron の IPC・MessagePort・WebSocket）は知らない。
 * `MessageChannel` からメッセージを受け、procedure を呼び、結果を同じ通信路へ返すだけで、
 * 殻ごとの事情（送り先の破棄・再読み込み）は通信路の実装が受け持つ
 * （Electron では `./electronIpcChannel.ts`）。
 *
 * 呼び出しと結果の扱いは tRPC 自身の部品（`callTRPCProcedure`・`getErrorShape`・
 * `getTRPCErrorFromUnknown`）に任せる。errorFormatter（`electron/trpc.ts`）と transformer
 * （superjson）は router の設定から読むので、HTTP や WebSocket の adapter と同じ形の
 * 応答になり、画面側の TRPCClientError も同じ形で届く。
 */
import {
  type AnyTRPCRouter,
  callTRPCProcedure,
  getErrorShape,
  getTRPCErrorFromUnknown,
  type inferRouterContext,
  isTrackedEnvelope,
  TRPCError,
} from '@trpc/server';
import {
  isObservable,
  observableToAsyncIterable,
} from '@trpc/server/observable';
import { match, P } from 'ts-pattern';
import { z } from 'zod';

import type {
  MessageChannel,
  OperationId,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { logger } from '../logger';

/**
 * 画面から届いたメッセージの形。
 *
 * 画面は信頼できない境界の向こう側にあるので、`ClientMessage` の型を信じず、
 * 受け取るたびにこのスキーマで確かめる。input の中身は procedure の input スキーマが確かめる。
 */
const ClientMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('call'),
    id: z.string().min(1),
    type: z.enum(['query', 'mutation', 'subscription']),
    path: z.string().min(1),
    input: z.unknown(),
  }),
  z.object({
    kind: z.literal('stop'),
    id: z.string().min(1),
  }),
]);

type CallMessage = Extract<
  z.infer<typeof ClientMessageSchema>,
  { kind: 'call' }
>;

type MaybePromise<T> = T | Promise<T>;

interface ServeTrpcOptions<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  /** 呼び出しごとに procedure へ渡す ctx を作る */
  createContext: () => MaybePromise<inferRouterContext<TRouter>>;
  /**
   * この接続の通信路。届くメッセージは画面から来た未検証の値なので、受信の型を
   * `ClientMessage` ではなく `unknown` とし、スキーマで確かめてから扱う。
   */
  channel: MessageChannel<ServerMessage, unknown>;
}

/** 購読の次の値を待つ間に stop が届いたことを表す */
const ABORTED = Symbol('aborted');

/**
 * 次の値か、購読の中止のどちらか早い方を返す。
 *
 * 購読は EventEmitter のイベントを待つ間ずっと next() が解決しないので、next() だけを
 * 待つと stop を受けても次のイベントまでループを抜けられない。中止の待ち受けは呼ぶたびに
 * 外し、長い購読で待ち受けが積み上がらないようにする。
 */
const nextOrAbort = <T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T> | TRPCError | typeof ABORTED> => {
  if (signal.aborted) {
    return Promise.resolve(ABORTED);
  }
  return new Promise((resolve) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    void iterator
      .next()
      .then(
        (result): IteratorResult<T> | TRPCError => result,
        getTRPCErrorFromUnknown,
      )
      .then((result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      });
  });
};

/**
 * 購読の非同期イテレーターを止める。
 *
 * 非同期ジェネレーターが await の途中にいると、return() は次の yield まで待たされる。
 * 画面への complete はそれを待たずに送り、後片付け（`finally` でのリスナー解除）は
 * ジェネレーターが yield に戻った時点で走らせる。procedure は購読の signal の中止で
 * 待ちを抜けるので（`electron/lib/eventQueue.ts`）、後片付けは次のイベントを待たない。
 */
const stopIterator = (iterator: AsyncIterator<unknown>) => {
  void Promise.resolve()
    .then(() => iterator.return?.())
    .catch((error: unknown) => {
      logger.error({
        message: 'tRPC の購読を止める途中で失敗しました',
        stack: getTRPCErrorFromUnknown(error),
      });
    });
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value;

/**
 * procedure の戻り値が購読（observable か非同期イテラブル）なら、非同期イテラブルとして返す。
 * 購読でなければ null を返す。
 */
const toAsyncIterable = (
  result: unknown,
  signal: AbortSignal,
): AsyncIterable<unknown> | null =>
  match(result)
    .when(isObservable, (observable) =>
      observableToAsyncIterable(observable, signal),
    )
    .when(isAsyncIterable, (iterable) => iterable)
    .otherwise(() => null);

/**
 * 通信路 1 本の上で router を提供する。
 *
 * 接続ごとに呼び、接続が切れたら（画面の破棄・再読み込み）返り値を呼ぶ。返り値は
 * 受信をやめ、この接続で続いている購読をすべて止める。止めた購読の complete は送らない
 * （送り先の画面はもう無い）。
 */
export const serveTrpc = <TRouter extends AnyTRPCRouter>({
  router,
  createContext,
  channel,
}: ServeTrpcOptions<TRouter>): (() => void) => {
  const config = router._def._config;
  /** 続いている購読。stop と接続の終わりで止めるために持つ */
  const subscriptions = new Map<OperationId, AbortController>();
  let disposed = false;

  const send = (message: ServerMessage) => {
    if (!disposed) {
      channel.send(message);
    }
  };

  const sendData = (id: OperationId, data: unknown) => {
    send({ kind: 'data', id, data: config.transformer.output.serialize(data) });
  };

  const sendError = (
    message: CallMessage,
    cause: unknown,
    state: { input: unknown; ctx: inferRouterContext<TRouter> | undefined },
  ) => {
    const shape: unknown = getErrorShape({
      config,
      error: getTRPCErrorFromUnknown(cause),
      type: message.type,
      path: message.path,
      input: state.input,
      ctx: state.ctx,
    });
    send({
      kind: 'error',
      id: message.id,
      error: config.transformer.output.serialize(shape),
    });
  };

  const iterate = async (
    message: CallMessage,
    iterable: AsyncIterable<unknown>,
    signal: AbortSignal,
    state: { input: unknown; ctx: inferRouterContext<TRouter> | undefined },
  ) => {
    const iterator = iterable[Symbol.asyncIterator]();
    while (true) {
      const next = await nextOrAbort(iterator, signal);
      const done = match(next)
        .with(ABORTED, () => {
          stopIterator(iterator);
          send({ kind: 'complete', id: message.id });
          return true;
        })
        .with(P.instanceOf(TRPCError), (error) => {
          sendError(message, error, state);
          return true;
        })
        .with({ done: true }, () => {
          send({ kind: 'complete', id: message.id });
          return true;
        })
        .otherwise(({ value }) => {
          // tracked() で包んだ値は、tRPC の WebSocket adapter と同じく { id, data } で送る
          sendData(
            message.id,
            isTrackedEnvelope(value) ? { id: value[0], data: value[1] } : value,
          );
          return false;
        });
      if (done) {
        return;
      }
    }
  };

  const call = async (
    message: CallMessage,
    signal: AbortSignal,
    state: { input: unknown; ctx: inferRouterContext<TRouter> | undefined },
  ) => {
    // trpc の他の adapter と同じく、input が無い呼び出しは deserialize しない
    state.input = message.input
      ? config.transformer.input.deserialize(message.input)
      : undefined;
    const ctx = await createContext();
    state.ctx = ctx;
    const input = state.input;
    const result: unknown = await callTRPCProcedure({
      ctx,
      path: message.path,
      router,
      getRawInput: async () => input,
      type: message.type,
      signal,
      // バッチにまとめずに 1 件ずつ呼ぶので、tRPC の WebSocket adapter と同じく 0
      batchIndex: 0,
    });

    const iterable = toAsyncIterable(result, signal);

    if (message.type !== 'subscription') {
      if (iterable) {
        throw new TRPCError({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Cannot return an async iterable or observable from a ${message.type} procedure.`,
        });
      }
      sendData(message.id, result);
      return;
    }

    if (!iterable) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Subscription ${message.path} did not return an observable or a AsyncGenerator`,
      });
    }

    await iterate(message, iterable, signal, state);
  };

  const handleCall = (message: CallMessage) => {
    const abortController = new AbortController();
    if (message.type === 'subscription') {
      if (subscriptions.has(message.id)) {
        sendError(
          message,
          new TRPCError({
            code: 'BAD_REQUEST',
            message: `Duplicate id ${message.id}`,
          }),
          { input: undefined, ctx: undefined },
        );
        return;
      }
      // procedure が値を返す前に stop が届いても止められるよう、呼ぶ前に登録する
      subscriptions.set(message.id, abortController);
    }

    const state: {
      input: unknown;
      ctx: inferRouterContext<TRouter> | undefined;
    } = { input: undefined, ctx: undefined };
    void call(message, abortController.signal, state)
      .catch((error: unknown) => {
        sendError(message, error, state);
      })
      .finally(() => {
        if (subscriptions.get(message.id) === abortController) {
          subscriptions.delete(message.id);
        }
      });
  };

  const handleStop = (id: OperationId) => {
    subscriptions.get(id)?.abort();
  };

  const stopListening = channel.onMessage((raw: unknown) => {
    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        'tRPC の通信路に不正な形のメッセージが届いたため無視しました',
        {
          issues: z.treeifyError(parsed.error),
        },
      );
      return;
    }
    match(parsed.data)
      .with({ kind: 'call' }, handleCall)
      .with({ kind: 'stop' }, ({ id }) => handleStop(id))
      .exhaustive();
  });

  return () => {
    disposed = true;
    stopListening();
    for (const controller of subscriptions.values()) {
      controller.abort();
    }
    subscriptions.clear();
  };
};
