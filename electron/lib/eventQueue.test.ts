import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '../../shared/trpcTransport';
import { eventEmitter, procedure, router } from '../trpc';
import { createEventQueue } from './eventQueue';
import { serveTrpc } from './trpcTransport/serveTrpc';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** api.ts の subscribeToast と同じ形で、EventEmitter のイベントを購読する */
const subscribeEvents = (emitter: EventEmitter, signal: AbortSignal) =>
  (async function* () {
    const queue = createEventQueue<unknown>(signal);
    const onEvent = (data: unknown) => queue.push(data);
    emitter.on('event', onEvent);
    // effect-lint-allow-try-catch: finally でイベントリスナーのクリーンアップが必要
    try {
      yield* queue.drain();
    } finally {
      emitter.off('event', onEvent);
    }
  })();

describe('createEventQueue', () => {
  it('届いた順に値を yield する', async () => {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    const iterator = subscribeEvents(emitter, controller.signal);

    const first = iterator.next();
    emitter.emit('event', 'a');
    emitter.emit('event', 'b');

    expect(await first).toEqual({ done: false, value: 'a' });
    expect(await iterator.next()).toEqual({ done: false, value: 'b' });
    controller.abort();
  });

  it('次のイベントを待つ間に中止されると、イベントを待たずに終わってリスナーを外す', async () => {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    const iterator = subscribeEvents(emitter, controller.signal);

    const pending = iterator.next();
    await flush();
    expect(emitter.listenerCount('event')).toBe(1);

    controller.abort();

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(emitter.listenerCount('event')).toBe(0);
  });
});

describe('serveTrpc の購読の停止', () => {
  const testRouter = router({
    events: procedure.subscription(async function* ({ signal }) {
      const queue = createEventQueue<unknown>(signal);
      const onToast = (data: unknown) => queue.push(data);
      eventEmitter.on('toast', onToast);
      // effect-lint-allow-try-catch: finally でイベントリスナーのクリーンアップが必要
      try {
        yield* queue.drain();
      } finally {
        eventEmitter.off('toast', onToast);
      }
    }),
  });

  /** 画面からのメッセージを直接流し込み、処理本体の送信を記録する通信路 */
  const createChannel = () => {
    let deliver: ((message: unknown) => void) | undefined;
    const sent: ServerMessage[] = [];
    return {
      sent,
      fromClient: (message: unknown) => deliver?.(message),
      channel: {
        send: (message: ServerMessage) => sent.push(message),
        onMessage: (listener: (message: unknown) => void) => {
          deliver = listener;
          return () => {
            deliver = undefined;
          };
        },
      },
    };
  };

  const listenerCountAfterStop = async (
    stop: (helpers: {
      fromClient: (message: unknown) => void;
      disconnect: () => void;
    }) => void,
  ) => {
    const before = eventEmitter.listenerCount('toast');
    const { channel, fromClient } = createChannel();
    const disconnect = serveTrpc({
      router: testRouter,
      createContext: () => ({ eventEmitter }),
      channel,
    });
    fromClient({
      kind: 'call',
      id: 'sub',
      type: 'subscription',
      path: 'events',
      input: undefined,
    });
    await vi.waitFor(() =>
      expect(eventEmitter.listenerCount('toast')).toBe(before + 1),
    );

    stop({ fromClient, disconnect });
    await flush();
    return eventEmitter.listenerCount('toast') - before;
  };

  it('stop を受けると、次のイベントを待たずにリスナーを外す', async () => {
    expect(
      await listenerCountAfterStop(({ fromClient }) =>
        fromClient({ kind: 'stop', id: 'sub' }),
      ),
    ).toBe(0);
  });

  it('接続が閉じられると（画面の再読み込み）、次のイベントを待たずにリスナーを外す', async () => {
    expect(await listenerCountAfterStop(({ disconnect }) => disconnect())).toBe(
      0,
    );
  });
});
