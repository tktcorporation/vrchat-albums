import type { MessagePortMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { createTestHost } from '../lib/host/testHost';
import {
  type BackendRuntime,
  createBackendController,
  type InitMessage,
} from './controller';

const init = (backgroundSync = false): InitMessage => ({
  kind: 'init',
  info: createTestHost().info,
  errorReporting: false,
  backgroundSync,
});

const createRuntime = () => ({
  openConnection: vi.fn<BackendRuntime['openConnection']>(),
  closeConnection: vi.fn<BackendRuntime['closeConnection']>(),
  setBackgroundSync: vi.fn<BackendRuntime['setBackgroundSync']>(),
  setWindowBounds: vi.fn<BackendRuntime['setWindowBounds']>(),
  shutdown: vi.fn<BackendRuntime['shutdown']>(() => Promise.resolve()),
});

const fakePort = () => {
  const close = vi.fn();
  return { port: { close } as unknown as MessagePortMain, close };
};

/** start の結果をテストから決められるようにする */
const setup = () => {
  let resolveStart: (runtime: BackendRuntime) => void = () => {};
  let rejectStart: (error: unknown) => void = () => {};
  const start = vi.fn(
    () =>
      new Promise<BackendRuntime>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      }),
  );
  const deps = {
    start,
    sendReady: vi.fn(),
    exit: vi.fn(() => Promise.resolve()),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const controller = createBackendController(deps);
  /** start は init の受け取りより後のマイクロタスクで呼ばれるので、呼ばれるのを待ってから決める */
  const started = () => vi.waitFor(() => expect(start).toHaveBeenCalled());
  return {
    controller,
    deps,
    resolveStart: async (runtime: BackendRuntime) => {
      await started();
      resolveStart(runtime);
    },
    rejectStart: async (error: unknown) => {
      await started();
      rejectStart(error);
    },
  };
};

describe('createBackendController', () => {
  it('準備の前に届いた指示を溜め、準備が済んだら届いた順に実行する', async () => {
    const { controller, deps, resolveStart } = setup();
    const runtime = createRuntime();
    const { port } = fakePort();

    controller.handle(init(), []);
    controller.handle({ kind: 'connect', connectionId: 'a' }, [port]);
    controller.handle({ kind: 'disconnect', connectionId: 'a' }, []);
    expect(runtime.openConnection).not.toHaveBeenCalled();

    await resolveStart(runtime);
    await vi.waitFor(() => expect(deps.sendReady).toHaveBeenCalled());

    expect(runtime.openConnection).toHaveBeenCalledWith('a', port);
    expect(runtime.closeConnection).toHaveBeenCalledWith('a');
    expect(runtime.openConnection.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.closeConnection.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('init の常駐中かどうかを、準備が済んだときに反映する', async () => {
    const { controller, deps, resolveStart } = setup();
    const runtime = createRuntime();

    controller.handle(init(true), []);
    await resolveStart(runtime);
    await vi.waitFor(() => expect(deps.sendReady).toHaveBeenCalled());

    expect(runtime.setBackgroundSync).toHaveBeenCalledWith(true);
  });

  it('起動に失敗したら 1 度だけ報告し、溜めた指示の port を閉じて終える', async () => {
    const { controller, deps, rejectStart } = setup();
    const first = fakePort();
    const second = fakePort();

    controller.handle(init(), []);
    controller.handle({ kind: 'connect', connectionId: 'a' }, [first.port]);
    controller.handle({ kind: 'connect', connectionId: 'b' }, [second.port]);
    controller.handle({ kind: 'setBackgroundSync', enabled: true }, []);

    await rejectStart(new Error('cannot open db'));
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));

    expect(deps.log.error).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(deps.sendReady).not.toHaveBeenCalled();

    // 失敗した後の指示も実行せず、報告もし直さない
    const later = fakePort();
    controller.handle({ kind: 'connect', connectionId: 'c' }, [later.port]);
    expect(later.close).toHaveBeenCalledTimes(1);
    expect(deps.log.error).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('start が同期的に投げても、同じく 1 度だけ報告して終える', async () => {
    const deps = {
      start: vi.fn((): Promise<BackendRuntime> => {
        throw new Error('sync failure');
      }),
      sendReady: vi.fn(),
      exit: vi.fn(() => Promise.resolve()),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const controller = createBackendController(deps);

    controller.handle(init(), []);
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));

    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });

  it('init より前の指示は捨て、port を閉じる', () => {
    const { controller, deps } = setup();
    const { port, close } = fakePort();

    controller.handle({ kind: 'connect', connectionId: 'a' }, [port]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('2 度目の init は無視する', async () => {
    const { controller, deps } = setup();

    controller.handle(init(), []);
    controller.handle(init(), []);
    await vi.waitFor(() => expect(deps.start).toHaveBeenCalled());

    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(deps.log.warn).toHaveBeenCalledWith(
      'Backend received init twice, ignoring',
    );
  });

  it('終了の後に届いた指示は実行せず、終了を待ってからプロセスを終える', async () => {
    const { controller, deps, resolveStart } = setup();
    const runtime = createRuntime();
    controller.handle(init(), []);
    await resolveStart(runtime);
    await vi.waitFor(() => expect(deps.sendReady).toHaveBeenCalled());

    controller.handle({ kind: 'shutdown' }, []);
    controller.handle({ kind: 'setBackgroundSync', enabled: true }, []);
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));

    expect(runtime.shutdown).toHaveBeenCalledTimes(1);
    expect(runtime.setBackgroundSync).toHaveBeenCalledTimes(1);
    expect(runtime.setBackgroundSync).toHaveBeenCalledWith(false);
  });

  it('溜めた指示の中の終了より後の指示は実行しない', async () => {
    const { controller, deps, resolveStart } = setup();
    const runtime = createRuntime();
    const { port, close } = fakePort();

    controller.handle(init(), []);
    controller.handle({ kind: 'shutdown' }, []);
    controller.handle({ kind: 'connect', connectionId: 'a' }, [port]);
    await resolveStart(runtime);
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));

    expect(runtime.openConnection).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('終了の処理が失敗しても報告してからプロセスを終える', async () => {
    const { controller, deps, resolveStart } = setup();
    const runtime = createRuntime();
    runtime.shutdown.mockRejectedValue(new Error('close failed'));
    controller.handle(init(), []);
    await resolveStart(runtime);
    await vi.waitFor(() => expect(deps.sendReady).toHaveBeenCalled());

    controller.handle({ kind: 'shutdown' }, []);
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));

    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });
});
