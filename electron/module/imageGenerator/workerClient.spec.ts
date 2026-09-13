import { EventEmitter } from 'node:events';

import { Effect, Exit } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * node:worker_threads の Worker をテスト用の EventEmitter で置き換える。
 * postMessage された内容は spy で検証できるようにする。
 */
class FakeWorker extends EventEmitter {
  postMessage = vi.fn();
  terminate = vi.fn();
}

let latestWorker: FakeWorker | undefined;
const WorkerConstructorSpy = vi.fn();

vi.mock('node:worker_threads', () => ({
  // コンストラクタから FakeWorker インスタンスを直接 return することで
  // new Worker(...) の戻り値を丸ごと差し替える
  Worker: class {
    constructor(...args: unknown[]) {
      WorkerConstructorSpy(...args);
      latestWorker = new FakeWorker();
      return latestWorker as unknown as this;
    }
  },
}));

import { runInWorker } from './workerClient';

const job = {
  outputFormat: 'png' as const,
  worldName: 'Test World',
  imageBase64: 'dGVzdA==',
  players: null,
  showAllPlayers: false,
  fontFilePaths: [],
};

/**
 * runInWorker が内部で Effect.timeoutFail を pipe しているため、
 * `new Worker()` の呼び出しは Effect のファイバースケジューリングにより
 * 1 マイクロタスク以上遅延する（Effect.runPromise 呼び出しの直後では
 * まだ実行されていない）。emit する前にこれを待つ。
 */
const waitForWorker = () => vi.waitFor(() => latestWorker ?? Promise.reject());

describe('runInWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestWorker = undefined;
  });

  it('should resolve the buffer decoded from a successful worker response', async () => {
    const resultPromise = Effect.runPromise(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('message', {
      ok: true,
      base64: Buffer.from('hello').toString('base64'),
    });

    const result = await resultPromise;
    expect(result.toString()).toBe('hello');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('should pass the job to the worker via postMessage', async () => {
    const resultPromise = Effect.runPromise(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    expect(worker.postMessage).toHaveBeenCalledWith(job);
    worker.emit('message', { ok: true, base64: '' });
    await resultPromise;
  });

  it('should reconstruct SvgRenderFailed from the worker-forwarded plain object', async () => {
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('message', {
      ok: false,
      error: { _tag: 'SvgRenderFailed', message: 'boom' },
    });

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('SvgRenderFailed');
      expect(exit.cause.toString()).toContain('boom');
    }
  });

  it('should reconstruct ImageConversionFailed from the worker-forwarded plain object', async () => {
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('message', {
      ok: false,
      error: { _tag: 'ImageConversionFailed', message: 'jpeg boom' },
    });

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('ImageConversionFailed');
      expect(exit.cause.toString()).toContain('jpeg boom');
    }
  });

  it('should convert an unrecognized error shape into WorkerCrashed', async () => {
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('message', { ok: false, error: 'not a tagged error' });

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('WorkerCrashed');
    }
  });

  it('should fail with WorkerCrashed when the worker emits an error event', async () => {
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('error', new Error('native crash'));

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('WorkerCrashed');
      expect(exit.cause.toString()).toContain('native crash');
    }
  });

  it('should fail with WorkerCrashed when the worker exits with a non-zero code', async () => {
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('exit', 1);

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('WorkerCrashed');
    }
  });

  it('should fail with WorkerCrashed (not hang forever) when the worker exits with code 0 without ever posting a message', async () => {
    // 修正前は 'exit' の code !== 0 の場合しか settle しておらず、message も
    // error も来ないまま code 0 で終了すると Effect が永久に未解決になっていた
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('exit', 0);

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('WorkerCrashed');
    }
  });

  it('should fail with WorkerCrashed and terminate the worker when no response arrives within the timeout', async () => {
    // worker が message/error/exit のいずれも発火せず応答を返さないケース
    // (resvg のネイティブハング等)を模擬する
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs', 10),
    );
    const worker = await waitForWorker();

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('WorkerCrashed');
    }
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('should not settle twice when exit fires after a successful message', async () => {
    const resultPromise = Effect.runPromise(
      runInWorker(job, '/fake/worker.cjs'),
    );
    const worker = await waitForWorker();
    worker.emit('message', { ok: true, base64: '' });
    worker.emit('exit', 0);

    await resultPromise;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
