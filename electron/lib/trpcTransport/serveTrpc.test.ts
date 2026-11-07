import { createTRPCClient, TRPCClientError } from '@trpc/client';
import {
  getErrorShape,
  getTRPCErrorFromUnknown,
  type inferRouterContext,
} from '@trpc/server';
import superjson from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type {
  ClientMessage,
  MessageChannel,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { messageLink } from '../../../src/trpc/messageLink';
import { eventEmitter, procedure, router } from '../../trpc';
import { ERROR_CATEGORIES, ERROR_CODES, UserFacingError } from '../errors';
import { serveTrpc } from './serveTrpc';

/**
 * 画面側と処理本体側をつなぐ、メモリ上の通信路。
 *
 * IPC と同じく、届くのは次のタスク以降で、値は構造化複製した写しになる。
 * 処理本体側が送ったメッセージは `sent` に残す。
 */
const createChannelPair = () => {
  const clientListeners = new Set<(message: ServerMessage) => void>();
  const serverListeners = new Set<(message: unknown) => void>();
  const sent: ServerMessage[] = [];

  const deliver = <T>(listeners: Set<(message: T) => void>, message: T) => {
    const copy = structuredClone(message);
    setTimeout(() => {
      for (const listener of listeners) {
        listener(copy);
      }
    }, 0);
  };

  const client: MessageChannel<ClientMessage, ServerMessage> = {
    send: (message) => deliver(serverListeners, message),
    onMessage: (listener) => {
      clientListeners.add(listener);
      return () => clientListeners.delete(listener);
    },
  };
  const server: MessageChannel<ServerMessage, unknown> = {
    send: (message) => {
      sent.push(message);
      deliver(clientListeners, message);
    },
    onMessage: (listener) => {
      serverListeners.add(listener);
      return () => serverListeners.delete(listener);
    },
  };
  /** 画面から任意の値を送る（不正な形のメッセージを試す） */
  const sendRaw = (raw: unknown) => deliver(serverListeners, raw);

  return { client, server, sent, sendRaw };
};

/** 購読を外から進めるための制御 */
const createTicker = () => {
  let release: (() => void) | undefined;
  const finallyRan = vi.fn();
  const waitRelease = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  return {
    finallyRan,
    waitRelease,
    release: () => release?.(),
  };
};

const ticker = createTicker();

const testRouter = router({
  echoDate: procedure
    .input(z.object({ at: z.date() }))
    .query(({ input }) => ({ at: input.at, year: input.at.getUTCFullYear() })),
  echoLabel: procedure.input(z.string()).query(async ({ input }) => {
    // 2 つのクライアントの応答が入れ替わる順にするため、短い方を後に返す
    await new Promise((resolve) => setTimeout(resolve, input.length));
    return input;
  }),
  increment: procedure.input(z.number()).mutation(({ input }) => input + 1),
  fail: procedure.query(() => {
    throw UserFacingError.withStructuredInfo({
      code: ERROR_CODES.FILE_NOT_FOUND,
      category: ERROR_CATEGORIES.FILE_NOT_FOUND,
      message: 'missing',
      userMessage: 'ファイルが見つかりません',
    });
  }),
  finite: procedure.subscription(async function* () {
    yield 1;
    yield 2;
  }),
  paused: procedure.subscription(async function* () {
    // effect-lint-allow-try-catch: return() で finally が走ることを確かめる
    try {
      yield 1;
      await ticker.waitRelease();
      yield 2;
      await ticker.waitRelease();
    } finally {
      ticker.finallyRan();
    }
  }),
});

type TestRouter = typeof testRouter;

const createContext = (): inferRouterContext<TestRouter> => ({ eventEmitter });

const createClient = (channel: MessageChannel<ClientMessage, ServerMessage>) =>
  createTRPCClient<TestRouter>({
    links: [messageLink<TestRouter>({ channel, transformer: superjson })],
  });

const waitFor = (condition: () => boolean) =>
  vi.waitFor(() => {
    expect(condition()).toBe(true);
  });

describe('serveTrpc と messageLink', () => {
  const disposers: (() => void)[] = [];

  const setup = () => {
    const pair = createChannelPair();
    const dispose = serveTrpc({
      router: testRouter,
      createContext,
      channel: pair.server,
    });
    disposers.push(dispose);
    return { ...pair, dispose, client: createClient(pair.client) };
  };

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    ticker.finallyRan.mockClear();
    ticker.release();
  });

  it('query の input と結果を transformer で運ぶ', async () => {
    const { client } = setup();
    const at = new Date('2024-05-06T07:08:09.000Z');

    const result = await client.echoDate.query({ at });

    expect(result.at).toBeInstanceOf(Date);
    expect(result.at.toISOString()).toBe(at.toISOString());
    expect(result.year).toBe(2024);
  });

  it('mutation の結果を返す', async () => {
    const { client } = setup();

    await expect(client.increment.mutate(41)).resolves.toBe(42);
  });

  it('失敗は errorFormatter で整形した形の TRPCClientError として届く', async () => {
    const { client } = setup();

    const error: unknown = await client.fail.query().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TRPCClientError);
    const clientError = error as TRPCClientError<TestRouter>;
    expect(clientError.message).toBe('ファイルが見つかりません');
    expect(clientError.data?.structuredError).toEqual({
      code: ERROR_CODES.FILE_NOT_FOUND,
      category: ERROR_CATEGORIES.FILE_NOT_FOUND,
      userMessage: 'ファイルが見つかりません',
    });

    const expected = getErrorShape({
      config: testRouter._def._config,
      error: getTRPCErrorFromUnknown(
        UserFacingError.withStructuredInfo({
          code: ERROR_CODES.FILE_NOT_FOUND,
          category: ERROR_CATEGORIES.FILE_NOT_FOUND,
          message: 'missing',
          userMessage: 'ファイルが見つかりません',
        }),
      ),
      type: 'query',
      path: 'fail',
      input: undefined,
      ctx: createContext(),
    });
    // stack は投げた場所ごとに違うので比べない
    const { stack: _actualStack, ...actualData } =
      clientError.shape?.data ?? {};
    const { stack: _expectedStack, ...expectedData } = expected.data;
    expect({ ...clientError.shape, data: actualData }).toEqual({
      ...expected,
      data: expectedData,
    });
  });

  it('subscription はサーバーが終えると data の後に complete が届く', async () => {
    const { client } = setup();
    const received: number[] = [];
    const onComplete = vi.fn();

    client.finite.subscribe(undefined, {
      onData: (value) => received.push(value),
      onComplete,
    });

    await waitFor(() => onComplete.mock.calls.length === 1);
    expect(received).toEqual([1, 2]);
  });

  it('購読をやめると stop が届き、ジェネレーターを return() で止めて complete を返す', async () => {
    const { client, sent } = setup();
    const received: number[] = [];

    const subscription = client.paused.subscribe(undefined, {
      onData: (value) => received.push(value),
    });
    await waitFor(() => received.length === 1);

    subscription.unsubscribe();

    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    // ジェネレーターは await の途中なので、return() は次の yield で効き finally が走る
    ticker.release();
    await waitFor(() => ticker.finallyRan.mock.calls.length === 1);
    expect(received).toEqual([1]);
  });

  it('同じ通信路の 2 つのクライアントの応答が混ざらない', async () => {
    const pair = createChannelPair();
    disposers.push(
      serveTrpc({ router: testRouter, createContext, channel: pair.server }),
    );
    const first = createClient(pair.client);
    const second = createClient(pair.client);

    // どちらもクライアントの最初の呼び出しなので、連番だけなら ID が重なる
    const [fromFirst, fromSecond] = await Promise.all([
      first.echoLabel.query('first-client-long-label'),
      second.echoLabel.query('second'),
    ]);

    expect(fromFirst).toBe('first-client-long-label');
    expect(fromSecond).toBe('second');
  });

  it('接続を閉じると続いている購読を止め、それ以降は何も送らない', async () => {
    const { client, sent, dispose } = setup();
    const received: number[] = [];

    client.paused.subscribe(undefined, {
      onData: (value) => received.push(value),
    });
    await waitFor(() => received.length === 1);
    const sentBeforeDispose = sent.length;

    dispose();
    ticker.release();

    await waitFor(() => ticker.finallyRan.mock.calls.length === 1);
    expect(sent).toHaveLength(sentBeforeDispose);
  });

  it('不正な形のメッセージは無視し、後続の呼び出しは通る', async () => {
    const { client, sent, sendRaw } = setup();

    sendRaw('garbage');
    sendRaw({ kind: 'call', id: 'x' });
    sendRaw({ kind: 'call', id: '', type: 'query', path: 'increment' });
    sendRaw({ kind: 'unknown', id: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sent).toHaveLength(0);
    await expect(client.increment.mutate(1)).resolves.toBe(2);
  });
});
