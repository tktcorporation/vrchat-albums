import { EventEmitter } from 'node:events';

import superjson from 'superjson';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ServerMessage } from '../../../shared/trpcTransport';
import { eventEmitter, procedure, router } from '../../trpc';
import {
  type ConnectableWebContents,
  type IpcReceiver,
  serveOverElectronIpc,
} from './electronIpcChannel';
import { TRPC_IPC_CHANNEL } from './ipcChannelName';
import { serveTrpc } from './serveTrpc';

/**
 * Electron の ipcMain と webContents の偽物。
 *
 * ipcMain は全ウィンドウで 1 つなので、ウィンドウを複数作るテストでも共有する。
 * webContents は画面からの送信（`sendFromRenderer`）と、処理本体からの送信の記録
 * （`received`）を持つ。
 */
const createFakeIpcMain = () => {
  const emitter = new EventEmitter();
  const ipcMain: IpcReceiver = {
    on: (channel, listener) => emitter.on(channel, listener),
    removeListener: (channel, listener) =>
      emitter.removeListener(channel, listener),
  };
  return {
    ipcMain,
    emit: (
      event: { sender: unknown; senderFrame: unknown },
      message: unknown,
    ) => emitter.emit(TRPC_IPC_CHANNEL, event, message),
    listenerCount: () => emitter.listenerCount(TRPC_IPC_CHANNEL),
  };
};

type FakeIpcMain = ReturnType<typeof createFakeIpcMain>;

const createFakeWebContents = (fakeIpcMain: FakeIpcMain) => {
  const events = new EventEmitter();
  const received: ServerMessage[] = [];
  let destroyed = false;
  const webContents: ConnectableWebContents & { mainFrame: object } = {
    mainFrame: {},
    isDestroyed: () => destroyed,
    send: (channel, message) => {
      expect(channel).toBe(TRPC_IPC_CHANNEL);
      received.push(structuredClone(message));
    },
    on: (event, listener) => events.on(event, listener),
    once: (event, listener) => events.once(event, listener),
  };
  return {
    webContents,
    received,
    /** main frame の画面から送る */
    sendFromRenderer: (message: unknown) =>
      fakeIpcMain.emit(
        { sender: webContents, senderFrame: webContents.mainFrame },
        message,
      ),
    /**
     * main frame の移動が始まった。ファイルのドロップのように will-navigate で取り消される
     * 移動でも Electron はこのイベントを発火する
     */
    startNavigation: () => {
      events.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false,
      });
    },
    /** main frame に新しい文書が読み込まれた（再読み込み・別ページへの移動） */
    commitNavigation: () => {
      // 新しい文書を表示する main frame は別のオブジェクトになりうる
      webContents.mainFrame = {};
      events.emit('did-navigate');
    },
    destroy: () => {
      destroyed = true;
      events.emit('destroyed');
    },
  };
};

/** 購読と遅い query を外から進めるための制御 */
const createGate = () => {
  let release: (() => void) | undefined;
  return {
    wait: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    release: () => release?.(),
  };
};

const gate = createGate();

const testRouter = router({
  echo: procedure.input(z.string()).query(({ input }) => input),
  slow: procedure.query(async () => {
    await gate.wait();
    return 'done';
  }),
  ticks: procedure.subscription(async function* () {
    yield 1;
    await new Promise(() => {});
  }),
});

const serve = (fakeIpcMain: FakeIpcMain, webContents: ConnectableWebContents) =>
  serveOverElectronIpc(
    webContents,
    (channel) =>
      serveTrpc({
        router: testRouter,
        createContext: () => ({ eventEmitter }),
        channel,
      }),
    fakeIpcMain.ipcMain,
  );

const call = (id: string, path: string, input?: string) => ({
  kind: 'call',
  id,
  type: path === 'ticks' ? 'subscription' : 'query',
  path,
  // 画面の link と同じく、input は transformer（superjson）で直列化して送る
  input: input === undefined ? undefined : superjson.serialize(input),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const idsOf = (received: readonly ServerMessage[]) =>
  received.map(({ kind, id }) => `${kind}:${id}`);

describe('serveOverElectronIpc', () => {
  it('他の webContents と main frame 以外から届いたメッセージは受け取らない', async () => {
    const fakeIpcMain = createFakeIpcMain();
    const target = createFakeWebContents(fakeIpcMain);
    const other = createFakeWebContents(fakeIpcMain);
    serve(fakeIpcMain, target.webContents);

    fakeIpcMain.emit(
      { sender: other.webContents, senderFrame: other.webContents.mainFrame },
      call('a', 'echo', 'x'),
    );
    fakeIpcMain.emit(
      { sender: target.webContents, senderFrame: {} },
      call('b', 'echo', 'x'),
    );
    await flush();

    expect(target.received).toEqual([]);
    expect(other.received).toEqual([]);
  });

  it('取り消された移動ではつなぎ直さず、続いている呼び出しの応答が届く', async () => {
    const fakeIpcMain = createFakeIpcMain();
    const window = createFakeWebContents(fakeIpcMain);
    serve(fakeIpcMain, window.webContents);

    window.sendFromRenderer(call('sub', 'ticks'));
    window.sendFromRenderer(call('slow', 'slow'));
    await flush();
    // 取り消された移動は始まりだけが届き、did-navigate は届かない
    window.startNavigation();
    gate.release();
    await flush();

    expect(idsOf(window.received)).toEqual(['data:sub', 'data:slow']);
    expect(fakeIpcMain.listenerCount()).toBe(1);
  });

  it('新しい文書が読み込まれると前の文書の購読を止め、新しい接続が新しい文書に応える', async () => {
    const fakeIpcMain = createFakeIpcMain();
    const window = createFakeWebContents(fakeIpcMain);
    serve(fakeIpcMain, window.webContents);

    window.sendFromRenderer(call('sub', 'ticks'));
    window.sendFromRenderer(call('slow', 'slow'));
    await flush();
    window.commitNavigation();
    gate.release();
    await flush();

    // 前の文書の購読と遅い query の結果は、もう無い画面へ送らない
    expect(idsOf(window.received)).toEqual(['data:sub']);
    expect(fakeIpcMain.listenerCount()).toBe(1);

    window.sendFromRenderer(call('next', 'echo', 'after'));
    await flush();
    expect(window.received.at(-1)).toMatchObject({ kind: 'data', id: 'next' });
  });

  it('webContents が破棄されたら接続を閉じ、それ以降は送らない', async () => {
    const fakeIpcMain = createFakeIpcMain();
    const window = createFakeWebContents(fakeIpcMain);
    serve(fakeIpcMain, window.webContents);

    window.sendFromRenderer(call('slow', 'slow'));
    await flush();
    window.destroy();
    gate.release();
    await flush();

    expect(window.received).toEqual([]);
    expect(fakeIpcMain.listenerCount()).toBe(0);
  });

  it('2 つ目のウィンドウにも別の接続が張られ、それぞれの画面にだけ応答が届く', async () => {
    const fakeIpcMain = createFakeIpcMain();
    const first = createFakeWebContents(fakeIpcMain);
    serve(fakeIpcMain, first.webContents);
    first.destroy();

    const second = createFakeWebContents(fakeIpcMain);
    const third = createFakeWebContents(fakeIpcMain);
    serve(fakeIpcMain, second.webContents);
    serve(fakeIpcMain, third.webContents);

    second.sendFromRenderer(call('s', 'echo', 'second'));
    third.sendFromRenderer(call('t', 'echo', 'third'));
    await flush();

    expect(first.received).toEqual([]);
    expect(idsOf(second.received)).toEqual(['data:s']);
    expect(idsOf(third.received)).toEqual(['data:t']);
  });
});
