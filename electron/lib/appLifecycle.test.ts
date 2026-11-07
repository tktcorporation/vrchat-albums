import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  type AppLifecycleDeps,
  createAppLifecycle,
  type LifecycleApp,
} from './appLifecycle';
import {
  type BackendChildProcess,
  createBackendSupervisor,
} from './backendProcess/supervisor';
import { createElectronUpdater } from './host/electronUpdater';
import { createTestHost } from './host/testHost';

/** `app` の偽物。購読を記録し、テストからイベントを起こせる */
const createFakeApp = () => {
  const emitter = new EventEmitter();
  const quit = vi.fn();
  const app = {
    on: (event: string, listener: (...args: unknown[]) => void) =>
      emitter.on(event, listener),
    quit,
  } as unknown as LifecycleApp;
  /** before-quit を起こし、取り消されたかを返す */
  const beforeQuit = (): boolean => {
    let prevented = false;
    emitter.emit('before-quit', {
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  return {
    app,
    quit,
    beforeQuit,
    emit: (event: string) => emitter.emit(event),
  };
};

const createFakeWindow = () => ({
  isDestroyed: vi.fn(() => false),
  hide: vi.fn(),
});

const setup = (overrides: Partial<AppLifecycleDeps> = {}) => {
  const fakeApp = createFakeApp();
  const window = createFakeWindow();
  const backend = {
    send: vi.fn(),
    stop: vi.fn(() => Promise.resolve()),
  };
  const saveWindowBounds = vi.fn();
  let backgroundEnabled = true;
  const lifecycle = createAppLifecycle({
    app: fakeApp.app,
    backend,
    getWindows: () => [window],
    saveWindowBounds,
    isBackgroundEnabled: () => backgroundEnabled,
    platform: 'win32',
    ...overrides,
  });
  return {
    ...fakeApp,
    window,
    backend,
    saveWindowBounds,
    lifecycle,
    setBackgroundEnabled: (enabled: boolean) => {
      backgroundEnabled = enabled;
    },
  };
};

describe('createAppLifecycle', () => {
  it('常駐が有効ならウィンドウをすべて閉じても終わらず、常駐に入る', () => {
    const { emit, quit, backend, lifecycle } = setup();

    emit('window-all-closed');

    expect(quit).not.toHaveBeenCalled();
    expect(lifecycle.isInBackground()).toBe(true);
    expect(backend.send).toHaveBeenCalledWith({
      kind: 'setBackgroundSync',
      enabled: true,
    });
  });

  it('常駐が無効ならウィンドウをすべて閉じたら終える', () => {
    const { emit, quit, setBackgroundEnabled, lifecycle } = setup();
    setBackgroundEnabled(false);

    emit('window-all-closed');

    expect(quit).toHaveBeenCalledTimes(1);
    expect(lifecycle.isInBackground()).toBe(false);
  });

  it('macOS ではウィンドウをすべて閉じても常駐に入らない', () => {
    const { emit, quit, backend, lifecycle } = setup({ platform: 'darwin' });

    emit('window-all-closed');

    expect(quit).not.toHaveBeenCalled();
    expect(lifecycle.isInBackground()).toBe(false);
    expect(backend.send).not.toHaveBeenCalled();
  });

  it('常駐中にウィンドウを作ったら常駐を抜け、同期を止めさせる', () => {
    const { emit, backend, lifecycle } = setup();
    emit('window-all-closed');
    backend.send.mockClear();

    emit('browser-window-created');

    expect(lifecycle.isInBackground()).toBe(false);
    expect(backend.send).toHaveBeenCalledWith({
      kind: 'setBackgroundSync',
      enabled: false,
    });
  });

  it('常駐していないときにウィンドウを作っても何も送らない', () => {
    const { emit, backend } = setup();

    emit('browser-window-created');

    expect(backend.send).not.toHaveBeenCalled();
  });

  it('終了では位置を保存し、ウィンドウを隠し、処理本体の終了を待ってから終える', async () => {
    const { beforeQuit, quit, window, backend, saveWindowBounds } = setup();
    let finishStop: () => void = () => {};
    backend.stop.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );

    expect(beforeQuit()).toBe(true);
    expect(saveWindowBounds).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
    expect(backend.stop).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();

    // 待っている間の before-quit も取り消し、手順は重ねない
    expect(beforeQuit()).toBe(true);
    expect(backend.stop).toHaveBeenCalledTimes(1);

    finishStop();
    await vi.waitFor(() => expect(quit).toHaveBeenCalled());

    // 手順が済んだ後の before-quit は通す
    expect(beforeQuit()).toBe(false);
  });

  it('破棄済みのウィンドウは隠さない', () => {
    const { beforeQuit, window } = setup();
    window.isDestroyed.mockReturnValue(true);

    beforeQuit();

    expect(window.hide).not.toHaveBeenCalled();
  });

  it('更新のインストールは処理本体を止めてから electron-updater に渡し、その後の before-quit は待たない', async () => {
    const { beforeQuit, backend, lifecycle } = setup();
    const order: string[] = [];
    backend.stop.mockImplementation(async () => {
      order.push('stop');
    });
    const autoUpdater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(() => {
        order.push('quitAndInstall');
        // electron-updater はインストーラを起動した後にアプリを終える
        order.push(beforeQuit() ? 'prevented' : 'quit');
      }),
    };
    const updater = createElectronUpdater(
      autoUpdater as unknown as Parameters<typeof createElectronUpdater>[0],
      {
        prepareQuit: () => lifecycle.shutdown(),
        forceQuit: () => lifecycle.forceQuit(),
        schedule: () => {},
      },
      true,
    );

    await updater.quitAndInstall();

    expect(order).toEqual(['stop', 'quitAndInstall', 'quit']);
    expect(backend.stop).toHaveBeenCalledTimes(1);
  });

  it('終了の手順が始まったら、ウィンドウを出す操作を実行しない', async () => {
    const { beforeQuit, lifecycle } = setup();
    const show = vi.fn();

    lifecycle.whenRunning(show);
    expect(show).toHaveBeenCalledTimes(1);
    expect(lifecycle.isShuttingDown()).toBe(false);

    beforeQuit();
    expect(lifecycle.isShuttingDown()).toBe(true);
    lifecycle.whenRunning(show);

    // 処理本体が終わった後も出さない
    await lifecycle.shutdown();
    lifecycle.whenRunning(show);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('終了が確定した後の強制終了は何もせず、確定していなければアプリを終える', () => {
    const { emit, quit, lifecycle } = setup();

    lifecycle.forceQuit();
    expect(quit).toHaveBeenCalledTimes(1);

    emit('will-quit');
    lifecycle.forceQuit();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe('更新のインストールの後の強制終了', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 終了の手順と electron-updater の偽物をつなぐ。`installs` が false ならインストーラを起動できない */
  const setupInstall = (installs: boolean) => {
    const env = setup();
    const autoUpdater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(() => {
        if (!installs) {
          return;
        }
        // electron-updater はインストーラを起動できたらアプリを終える。終了は確定まで進む
        if (!env.beforeQuit()) {
          env.emit('will-quit');
        }
      }),
    };
    const updater = createElectronUpdater(
      autoUpdater as unknown as Parameters<typeof createElectronUpdater>[0],
      {
        prepareQuit: () => env.lifecycle.shutdown(),
        forceQuit: () => env.lifecycle.forceQuit(),
      },
      true,
    );
    return { ...env, updater };
  };

  it('インストーラが起動してアプリが終わり始めたら、強制終了しない', async () => {
    const { updater, quit } = setupInstall(true);

    await updater.quitAndInstall();
    await vi.runAllTimersAsync();

    expect(quit).not.toHaveBeenCalled();
  });

  it('インストーラが起動せずアプリが残ったら、待ちの上限で終える', async () => {
    const { updater, quit } = setupInstall(false);

    await updater.quitAndInstall();
    expect(quit).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();

    expect(quit).toHaveBeenCalledTimes(1);
  });
});

/** utilityProcess の偽物。init の中身を読むためだけに使う */
class FakeChild extends EventEmitter {
  readonly pid = 1;
  readonly stdout = null;
  readonly stderr = null;
  readonly inits: unknown[] = [];
  readonly kill = vi.fn();

  postMessage(message: unknown): void {
    if ((message as { kind: string }).kind === 'init') {
      this.inits.push(message);
    }
  }
}

describe('createAppLifecycle と処理本体の起動し直し', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('処理本体が止まっている間に常駐へ入っても、起動し直した処理本体が同期を始める', async () => {
    const fakeApp = createFakeApp();
    const children: FakeChild[] = [];
    const host = createTestHost();
    const backend = createBackendSupervisor({
      hostInfo: host.info,
      errorReporting: false,
      shell: host.shell,
      updater: host.updater,
      onRestarted: vi.fn(),
      onGiveUp: vi.fn(),
      isBackgroundSyncEnabled: () => lifecycle.isInBackground(),
      fork: () => {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as BackendChildProcess;
      },
    });
    const lifecycle = createAppLifecycle({
      app: fakeApp.app,
      backend,
      getWindows: () => [],
      saveWindowBounds: vi.fn(),
      isBackgroundEnabled: () => true,
      platform: 'linux',
    });
    backend.start();
    expect(children[0]?.inits).toEqual([
      expect.objectContaining({ backgroundSync: false }),
    ]);

    children[0]?.emit('exit', 1);
    fakeApp.emit('window-all-closed');
    await vi.runOnlyPendingTimersAsync();

    expect(children).toHaveLength(2);
    expect(children[1]?.inits).toEqual([
      expect.objectContaining({ backgroundSync: true }),
    ]);
  });
});
