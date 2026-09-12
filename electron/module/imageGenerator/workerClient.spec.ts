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

let latestWorker: FakeWorker;
const WorkerConstructorSpy = vi.fn();

vi.mock('node:worker_threads', () => ({
  Worker: class {
    constructor(...args: unknown[]) {
      WorkerConstructorSpy(...args);
      latestWorker = new FakeWorker();
      // biome-ignore-line: テスト用にコンストラクタが FakeWorker を返す代わりにプロパティをコピーする
      Object.assign(this, latestWorker);
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

describe('runInWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve the buffer decoded from a successful worker response', async () => {
    const resultPromise = Effect.runPromise(
      runInWorker(job, '/fake/worker.cjs'),
    );
    latestWorker.emit('message', {
      ok: true,
      base64: Buffer.from('hello').toString('base64'),
    });

    const result = await resultPromise;
    expect(result.toString()).toBe('hello');
    expect(latestWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('should pass the job to the worker via postMessage', async () => {
    const resultPromise = Effect.runPromise(
      runInWorker(job, '/fake/worker.cjs'),
    );
    expect(latestWorker.postMessage).toHaveBeenCalledWith(job);
    latestWorker.emit('message', { ok: true, base64: '' });
    await resultPromise;
  });

  it('should fail with the ImageGenerationError forwarded by the worker', async () => {
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    latestWorker.emit('message', {
      ok: false,
      error: { _tag: 'SvgRenderFailed', message: 'boom' },
    });

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('SvgRenderFailed');
    }
  });

  it('should convert an unrecognized error shape into WorkerCrashed', async () => {
    const exitPromise = Effect.runPromiseExit(
      runInWorker(job, '/fake/worker.cjs'),
    );
    latestWorker.emit('message', { ok: false, error: 'not a tagged error' });

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
    latestWorker.emit('error', new Error('native crash'));

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
    latestWorker.emit('exit', 1);

    const exit = await exitPromise;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('WorkerCrashed');
    }
  });

  it('should not settle twice when exit fires after a successful message', async () => {
    const resultPromise = Effect.runPromise(
      runInWorker(job, '/fake/worker.cjs'),
    );
    latestWorker.emit('message', { ok: true, base64: '' });
    latestWorker.emit('exit', 0);

    await resultPromise;
    expect(latestWorker.terminate).toHaveBeenCalledTimes(1);
  });
});
