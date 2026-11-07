import { EventEmitter } from 'node:events';

import superjson from 'superjson';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ServerMessage } from '../../../shared/trpcTransport';
import { eventEmitter, procedure, router } from '../../trpc';
import { type ServerPort, serveTrpcOnPort } from './backend';

const testRouter = router({
  echo: procedure.input(z.string()).query(({ input }) => input),
});

/** MessagePortMain の偽物。'close' は相手側の port が閉じたことを表す */
const createFakePort = () => {
  const events = new EventEmitter();
  const posted: ServerMessage[] = [];
  let closed = false;
  const port: ServerPort = {
    // 'message' と 'close' の 2 つの形を EventEmitter 1 つで受ける
    on: ((event: string, listener: () => void) =>
      events.on(event, listener)) as ServerPort['on'],
    removeListener: (event, listener) => events.removeListener(event, listener),
    postMessage: (message) => {
      posted.push(structuredClone(message));
    },
    start: () => {},
    close: () => {
      closed = true;
    },
  };
  return {
    port,
    posted,
    isClosed: () => closed,
    send: (data: unknown) => events.emit('message', { data }),
    closeRemote: () => events.emit('close'),
    messageListenerCount: () => events.listenerCount('message'),
  };
};

const echo = (id: string, input: string) => ({
  kind: 'call',
  id,
  type: 'query',
  path: 'echo',
  input: superjson.serialize(input),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const serve = (fake: ReturnType<typeof createFakePort>) =>
  serveTrpcOnPort(fake.port, {
    router: testRouter,
    createContext: () => ({ eventEmitter }),
  });

describe('serveTrpcOnPort', () => {
  it('port から届いた呼び出しに、同じ port で応える', async () => {
    const fake = createFakePort();
    serve(fake);

    fake.send(echo('a', 'hello'));
    await flush();

    expect(fake.posted).toMatchObject([{ kind: 'data', id: 'a' }]);
  });

  it('相手側の port が閉じたら受信をやめ、port を閉じる', async () => {
    const fake = createFakePort();
    serve(fake);

    fake.closeRemote();
    fake.send(echo('a', 'hello'));
    await flush();

    expect(fake.posted).toEqual([]);
    expect(fake.isClosed()).toBe(true);
    expect(fake.messageListenerCount()).toBe(0);
  });

  it('閉じる関数を呼ぶと port を閉じ、2 度目は何もしない', () => {
    const fake = createFakePort();
    const close = serve(fake);

    close();
    close();

    expect(fake.isClosed()).toBe(true);
    expect(fake.messageListenerCount()).toBe(0);
  });
});
