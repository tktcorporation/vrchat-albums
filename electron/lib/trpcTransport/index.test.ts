import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  type BrokeredWebContents,
  type BrokerShell,
  startTrpcBroker,
} from './index';
import { TRPC_PORT_CHANNEL, TRPC_PORT_REQUEST_CHANNEL } from './ipcChannelName';

/** MessageChannelMain の偽物の port。どの組のどちら側かだけを持つ */
interface FakePort {
  readonly pair: number;
  readonly side: 1 | 2;
}

type Event =
  | { kind: 'connect'; connectionId: string; port: FakePort }
  | { kind: 'disconnect'; connectionId: string };

/** Electron の ipcMain・MessageChannelMain・webContents と、処理本体の偽物 */
const createFake = () => {
  const ipcEvents = new EventEmitter();
  let pairs = 0;
  const shell: BrokerShell<FakePort> = {
    ipcMain: {
      on: (channel, listener) => ipcEvents.on(channel, listener),
      removeListener: (channel, listener) =>
        ipcEvents.removeListener(channel, listener),
    },
    createChannel: () => {
      pairs += 1;
      return {
        port1: { pair: pairs, side: 1 },
        port2: { pair: pairs, side: 2 },
      };
    },
  };
  const backendEvents: Event[] = [];
  const backend = {
    connect: (connectionId: string, port: FakePort) => {
      backendEvents.push({ kind: 'connect', connectionId, port });
    },
    disconnect: (connectionId: string) => {
      backendEvents.push({ kind: 'disconnect', connectionId });
    },
  };

  const createWebContents = () => {
    const events = new EventEmitter();
    const delivered: { channel: string; ports: FakePort[] }[] = [];
    let destroyed = false;
    const webContents: BrokeredWebContents<FakePort> = {
      mainFrame: {},
      isDestroyed: () => destroyed,
      postMessage: (channel, _message, transfer) => {
        delivered.push({ channel, ports: transfer });
      },
      once: (event, listener) => events.once(event, listener),
    };
    return {
      delivered,
      /** preload が読み込まれ、main frame から port を頼む */
      requestPort: (frame: unknown = webContents.mainFrame) =>
        ipcEvents.emit(TRPC_PORT_REQUEST_CHANNEL, {
          sender: webContents,
          senderFrame: frame,
        }),
      destroy: () => {
        destroyed = true;
        events.emit('destroyed');
      },
    };
  };

  return {
    shell,
    backend,
    backendEvents,
    createWebContents,
    requestListenerCount: () =>
      ipcEvents.listenerCount(TRPC_PORT_REQUEST_CHANNEL),
  };
};

describe('startTrpcBroker', () => {
  it('依頼ごとに port の組を作り、片方を処理本体へ、もう片方を依頼した画面へ渡す', () => {
    const fake = createFake();
    startTrpcBroker({ backend: fake.backend }, fake.shell);
    const first = fake.createWebContents();
    const second = fake.createWebContents();

    first.requestPort();
    second.requestPort();

    expect(fake.backendEvents).toMatchObject([
      { kind: 'connect', port: { pair: 1, side: 1 } },
      { kind: 'connect', port: { pair: 2, side: 1 } },
    ]);
    expect(first.delivered).toEqual([
      { channel: TRPC_PORT_CHANNEL, ports: [{ pair: 1, side: 2 }] },
    ]);
    expect(second.delivered).toEqual([
      { channel: TRPC_PORT_CHANNEL, ports: [{ pair: 2, side: 2 }] },
    ]);
  });

  it('同じ画面が読み込み直されたら、前の文書の接続を閉じさせてから新しい接続を渡す', () => {
    const fake = createFake();
    startTrpcBroker({ backend: fake.backend }, fake.shell);
    const webContents = fake.createWebContents();

    webContents.requestPort();
    webContents.requestPort();

    const [firstConnect, disconnect, secondConnect] = fake.backendEvents;
    expect(firstConnect?.kind).toBe('connect');
    expect(disconnect).toEqual({
      kind: 'disconnect',
      connectionId: firstConnect?.connectionId,
    });
    expect(secondConnect?.kind).toBe('connect');
    expect(secondConnect?.connectionId).not.toBe(firstConnect?.connectionId);
    expect(webContents.delivered).toHaveLength(2);
  });

  it('iframe からの依頼には応えない', () => {
    const fake = createFake();
    startTrpcBroker({ backend: fake.backend }, fake.shell);
    const webContents = fake.createWebContents();

    webContents.requestPort({});

    expect(fake.backendEvents).toEqual([]);
    expect(webContents.delivered).toEqual([]);
  });

  it('画面が破棄されたら、その接続を閉じさせる', () => {
    const fake = createFake();
    startTrpcBroker({ backend: fake.backend }, fake.shell);
    const webContents = fake.createWebContents();
    webContents.requestPort();
    const connectionId = fake.backendEvents[0]?.connectionId;

    webContents.destroy();

    expect(fake.backendEvents.at(-1)).toEqual({
      kind: 'disconnect',
      connectionId,
    });
  });

  it('止めると依頼の受け付けをやめ、配った接続を閉じさせる', () => {
    const fake = createFake();
    const stop = startTrpcBroker({ backend: fake.backend }, fake.shell);
    const webContents = fake.createWebContents();
    webContents.requestPort();
    const connectionId = fake.backendEvents[0]?.connectionId;

    stop();
    webContents.requestPort();

    expect(fake.backendEvents).toHaveLength(2);
    expect(fake.backendEvents[1]).toEqual({ kind: 'disconnect', connectionId });
    expect(fake.requestListenerCount()).toBe(0);
  });
});
