import { describe, expect, it } from 'vitest';

import type {
  ClientMessage,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { TRPC_PORT_CHANNEL, TRPC_PORT_REQUEST_CHANNEL } from './ipcChannelName';
import {
  type BridgePort,
  createPortBridge,
  type PortReceiver,
} from './portBridge';

const createFakePort = () => {
  const posted: ClientMessage[] = [];
  let closed = false;
  let started = false;
  const port: BridgePort = {
    onmessage: null,
    postMessage: (message) => {
      posted.push(message);
    },
    start: () => {
      started = true;
    },
    close: () => {
      closed = true;
    },
  };
  return {
    port,
    posted,
    isClosed: () => closed,
    isStarted: () => started,
    receive: (data: ServerMessage) => port.onmessage?.({ data }),
  };
};

const createFakeIpc = () => {
  const sent: string[] = [];
  const listeners: {
    channel: string;
    listener: (event: { readonly ports: readonly BridgePort[] }) => void;
  }[] = [];
  const ipc: PortReceiver = {
    send: (channel) => {
      sent.push(channel);
    },
    on: (channel, listener) => {
      listeners.push({ channel, listener });
    },
  };
  return {
    ipc,
    sent,
    deliver: (port: BridgePort) => {
      for (const entry of listeners) {
        if (entry.channel === TRPC_PORT_CHANNEL) {
          entry.listener({ ports: [port] });
        }
      }
    },
  };
};

const call = (id: string): ClientMessage => ({
  kind: 'call',
  id,
  type: 'query',
  path: 'echo',
  input: null,
});

describe('createPortBridge', () => {
  it('作った時点で main へ port を頼む', () => {
    const fake = createFakeIpc();
    createPortBridge(fake.ipc);
    expect(fake.sent).toEqual([TRPC_PORT_REQUEST_CHANNEL]);
  });

  it('port が届くまでの送信を貯め、届いたら順に送る', () => {
    const fake = createFakeIpc();
    const bridge = createPortBridge(fake.ipc);
    bridge.send(call('a'));
    bridge.send(call('b'));
    const port = createFakePort();

    fake.deliver(port.port);
    bridge.send(call('c'));

    expect(port.isStarted()).toBe(true);
    expect(port.posted.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('届いた応答を登録した受信へ渡し、登録をやめたら渡さない', () => {
    const fake = createFakeIpc();
    const bridge = createPortBridge(fake.ipc);
    const port = createFakePort();
    fake.deliver(port.port);
    const received: ServerMessage[] = [];
    const stop = bridge.onMessage((message) => received.push(message));

    port.receive({ kind: 'complete', id: 'a' });
    stop();
    port.receive({ kind: 'complete', id: 'b' });

    expect(received).toEqual([{ kind: 'complete', id: 'a' }]);
  });

  it('port が配り直されたら前の port を閉じ、登録済みの受信を新しい port へつなぎ替える', () => {
    const fake = createFakeIpc();
    const bridge = createPortBridge(fake.ipc);
    const received: ServerMessage[] = [];
    bridge.onMessage((message) => received.push(message));
    const first = createFakePort();
    const second = createFakePort();

    fake.deliver(first.port);
    fake.deliver(second.port);
    second.receive({ kind: 'complete', id: 'x' });
    bridge.send(call('y'));

    expect(first.isClosed()).toBe(true);
    expect(received).toEqual([{ kind: 'complete', id: 'x' }]);
    expect(first.posted).toEqual([]);
    expect(second.posted.map((m) => m.id)).toEqual(['y']);
  });
});
