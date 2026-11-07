import { EventEmitter } from 'node:events';

import type { MessagePortMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createTestHost } from '../host/testHost';
import { BACKEND_SHUTDOWN_TIMEOUT_MS } from './protocol';
import {
  type BackendChildProcess,
  type BackendSupervisorOptions,
  createBackendSupervisor,
  type ForkBackend,
} from './supervisor';

/** utilityProcess の偽物。送られたメッセージを記録し、テストから終了を起こせる */
class FakeChild extends EventEmitter {
  readonly pid = 1;
  readonly stdout = null;
  readonly stderr = null;
  readonly posted: { message: unknown; ports?: unknown[] }[] = [];
  readonly kill = vi.fn(() => {
    this.exit(1);
    return true;
  });

  postMessage(message: unknown, ports?: unknown[]): void {
    this.posted.push({ message, ports });
  }

  exit(code: number): void {
    this.emit('exit', code);
  }

  kinds(): string[] {
    return this.posted.map(({ message }) => (message as { kind: string }).kind);
  }
}

const setup = (overrides: Partial<BackendSupervisorOptions> = {}) => {
  const children: FakeChild[] = [];
  const fork: ForkBackend = () => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as BackendChildProcess;
  };
  let background = false;
  const host = createTestHost();
  const onRestarted = vi.fn();
  const onGiveUp = vi.fn();
  const supervisor = createBackendSupervisor({
    hostInfo: host.info,
    errorReporting: false,
    shell: host.shell,
    updater: host.updater,
    onRestarted,
    onGiveUp,
    isBackgroundSyncEnabled: () => background,
    fork,
    ...overrides,
  });
  return {
    supervisor,
    children,
    onRestarted,
    onGiveUp,
    setBackground: (enabled: boolean) => {
      background = enabled;
    },
    latest: () => {
      const child = children.at(-1);
      if (child === undefined) {
        throw new Error('no child spawned');
      }
      return child;
    },
  };
};

const fakePort = () => {
  const close = vi.fn();
  return { port: { close } as unknown as MessagePortMain, close };
};

describe('createBackendSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('起動時の init に、その時点で常駐中かを含める', () => {
    const { supervisor, setBackground, latest } = setup();
    setBackground(true);
    supervisor.start();

    expect(latest().posted[0]?.message).toMatchObject({
      kind: 'init',
      backgroundSync: true,
    });
  });

  it('常駐中に処理本体が落ちたら、起動し直した処理本体へ常駐中であることを送り直す', async () => {
    const { supervisor, children, setBackground, onRestarted } = setup();
    setBackground(true);
    supervisor.start();
    children[0]?.exit(1);

    await vi.runOnlyPendingTimersAsync();

    expect(children).toHaveLength(2);
    expect(children[1]?.posted[0]?.message).toMatchObject({
      kind: 'init',
      backgroundSync: true,
    });
    expect(onRestarted).toHaveBeenCalledTimes(1);
  });

  it('止まっている間に常駐へ入ったら、送れなかった指示の代わりに次の init で伝える', async () => {
    const { supervisor, children, setBackground } = setup();
    supervisor.start();
    children[0]?.exit(1);

    // 処理本体が止まっている間の指示は捨てられる
    setBackground(true);
    supervisor.send({ kind: 'setBackgroundSync', enabled: true });
    expect(children[0]?.kinds()).toEqual(['init']);

    await vi.runOnlyPendingTimersAsync();

    expect(children[1]?.posted[0]?.message).toMatchObject({
      kind: 'init',
      backgroundSync: true,
    });
  });

  it('起動し直しの待ちの間に止めたら、起動し直さない', async () => {
    const { supervisor, children, onRestarted } = setup();
    supervisor.start();
    children[0]?.exit(1);

    await supervisor.stop();
    await vi.runAllTimersAsync();

    expect(children).toHaveLength(1);
    expect(onRestarted).not.toHaveBeenCalled();
  });

  it('終了を頼んだ後の終了は予期しない終了として扱わない', async () => {
    const { supervisor, latest, children, onRestarted } = setup();
    supervisor.start();
    const child = latest();

    const stopping = supervisor.stop();
    expect(child.kinds()).toEqual(['init', 'shutdown']);
    child.exit(0);
    await stopping;
    await vi.runAllTimersAsync();

    expect(children).toHaveLength(1);
    expect(onRestarted).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('処理本体が動いていなければ、止めるのはすぐ終わる', async () => {
    const { supervisor, children } = setup();

    await supervisor.stop();
    supervisor.start();

    expect(children).toHaveLength(0);
  });

  it('終了を頼んでも終わらなければ、待ちの上限で強制終了する', async () => {
    const { supervisor, latest } = setup();
    supervisor.start();
    // 偽物は shutdown を受けても終わらず、強制終了されて初めて exit を出す
    const child = latest();

    const stopping = supervisor.stop();
    await vi.advanceTimersByTimeAsync(BACKEND_SHUTDOWN_TIMEOUT_MS - 1);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('処理本体が動いていなければ、画面の接続の port を閉じる', () => {
    const { supervisor, children } = setup();
    supervisor.start();
    children[0]?.exit(1);

    const { port, close } = fakePort();
    supervisor.connect('connection-1', port);

    expect(close).toHaveBeenCalledTimes(1);
    expect(children[0]?.kinds()).toEqual(['init']);
  });

  it('処理本体が動いていれば、port を添えて接続を渡す', () => {
    const { supervisor, latest } = setup();
    supervisor.start();

    const { port, close } = fakePort();
    supervisor.connect('connection-1', port);

    expect(close).not.toHaveBeenCalled();
    expect(latest().posted[1]).toEqual({
      message: { kind: 'connect', connectionId: 'connection-1' },
      ports: [port],
    });
  });
});
