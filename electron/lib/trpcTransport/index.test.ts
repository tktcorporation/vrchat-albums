import { EventEmitter } from 'node:events';

import superjson from 'superjson';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ServerMessage } from '../../../shared/trpcTransport';
import { eventEmitter, procedure, router } from '../../trpc';
import type { ConnectableWebContents } from './electronIpcChannel';
import { startTrpcServer } from './index';
import { TRPC_IPC_CHANNEL } from './ipcChannelName';

const testRouter = router({
  echo: procedure.input(z.string()).query(({ input }) => input),
});

/** Electron の app・ipcMain・BrowserWindow の偽物 */
const createFakeShell = () => {
  const appEvents = new EventEmitter();
  const ipcEvents = new EventEmitter();
  const shell: NonNullable<Parameters<typeof startTrpcServer>[1]> = {
    app: {
      on: (event, listener) => appEvents.on(event, listener),
      removeListener: (event, listener) =>
        appEvents.removeListener(event, listener),
    },
    ipcMain: {
      on: (channel, listener) => ipcEvents.on(channel, listener),
      removeListener: (channel, listener) =>
        ipcEvents.removeListener(channel, listener),
    },
  };

  const createWindow = () => {
    const events = new EventEmitter();
    const received: ServerMessage[] = [];
    let destroyed = false;
    const webContents: ConnectableWebContents = {
      mainFrame: {},
      isDestroyed: () => destroyed,
      send: (_channel, message) => {
        received.push(structuredClone(message));
      },
      on: (event, listener) => events.on(event, listener),
      once: (event, listener) => events.once(event, listener),
    };
    // BrowserWindow のコンストラクタと同じく、作った時点で同期的に通知する
    appEvents.emit('browser-window-created', {}, { webContents });
    return {
      received,
      sendFromRenderer: (message: unknown) =>
        ipcEvents.emit(
          TRPC_IPC_CHANNEL,
          { sender: webContents, senderFrame: webContents.mainFrame },
          message,
        ),
      destroy: () => {
        destroyed = true;
        events.emit('destroyed');
      },
    };
  };

  return {
    shell,
    createWindow,
    windowListenerCount: () =>
      appEvents.listenerCount('browser-window-created'),
    ipcListenerCount: () => ipcEvents.listenerCount(TRPC_IPC_CHANNEL),
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

const start = (fake: ReturnType<typeof createFakeShell>) =>
  startTrpcServer(
    { router: testRouter, createContext: () => ({ eventEmitter }) },
    fake.shell,
  );

describe('startTrpcServer', () => {
  it('作られたウィンドウのそれぞれに接続を張り、その画面にだけ応答する', async () => {
    const fake = createFakeShell();
    start(fake);

    const first = fake.createWindow();
    const second = fake.createWindow();
    first.sendFromRenderer(echo('a', 'first'));
    second.sendFromRenderer(echo('b', 'second'));
    await flush();

    expect(first.received).toMatchObject([{ kind: 'data', id: 'a' }]);
    expect(second.received).toMatchObject([{ kind: 'data', id: 'b' }]);
  });

  it('止めると張った接続を閉じ、以後に作られたウィンドウにはつながない', async () => {
    const fake = createFakeShell();
    const stop = start(fake);
    const before = fake.createWindow();
    const destroyedBefore = fake.createWindow();
    destroyedBefore.destroy();

    stop();
    const after = fake.createWindow();
    before.sendFromRenderer(echo('a', 'x'));
    after.sendFromRenderer(echo('b', 'x'));
    await flush();

    expect(before.received).toEqual([]);
    expect(after.received).toEqual([]);
    expect(fake.windowListenerCount()).toBe(0);
    expect(fake.ipcListenerCount()).toBe(0);
  });
});
