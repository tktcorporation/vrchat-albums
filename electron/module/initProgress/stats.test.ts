import { describe, expect, it, vi } from 'vitest';

import { createThrottledRunner, toInitStats } from './stats';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/** 時刻とタイマーを手で進めるための偽物 */
const createManualTimers = () => {
  let now = 0;
  let pending: { at: number; callback: () => void } | null = null;
  return {
    timers: {
      now: () => now,
      setTimer: (callback: () => void, ms: number) => {
        pending = { at: now + ms, callback };
        return pending;
      },
      clearTimer: () => {
        pending = null;
      },
    },
    advance: (ms: number) => {
      now += ms;
      if (pending && pending.at <= now) {
        const { callback } = pending;
        pending = null;
        callback();
      }
    },
  };
};

/** マイクロタスクを流して、実行中タスクの完了処理を進める */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createThrottledRunner', () => {
  it('間隔内の要求をまとめ、間隔の終わりに 1 回だけ実行する', async () => {
    const { timers, advance } = createManualTimers();
    const task = vi.fn(() => Promise.resolve());
    const runner = createThrottledRunner(task, 100, timers);

    runner.request();
    await settle();
    expect(task).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      advance(4);
      runner.request();
    }
    await settle();
    expect(task).toHaveBeenCalledTimes(1);

    advance(20);
    await settle();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('1 秒間に要求し続けても実行は 10 回程度に収まる', async () => {
    const { timers, advance } = createManualTimers();
    const task = vi.fn(() => Promise.resolve());
    const runner = createThrottledRunner(task, 100, timers);

    for (let elapsed = 0; elapsed < 1000; elapsed += 5) {
      runner.request();
      advance(5);
      await settle();
    }
    expect(task.mock.calls.length).toBeLessThanOrEqual(11);
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it('実行中に来た要求は、終わった後にもう 1 回実行して取りこぼさない', async () => {
    const { timers, advance } = createManualTimers();
    let finish: () => void = () => {};
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const runner = createThrottledRunner(task, 100, timers);

    runner.request();
    runner.request();
    expect(task).toHaveBeenCalledTimes(1);

    advance(150);
    finish();
    await settle();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('flush は予約を待たずに実行し、完了を待つ', async () => {
    const { timers } = createManualTimers();
    const order: string[] = [];
    const task = vi.fn(async () => {
      order.push('run');
    });
    const runner = createThrottledRunner(task, 100, timers);

    runner.request();
    runner.request(); // 間隔内なので予約される
    await settle();
    await runner.flush();
    order.push('flushed');

    expect(task).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['run', 'run', 'flushed']);
  });
});

describe('toInitStats', () => {
  it('月を昇順に並べ、写真枚数を月別枚数の合計にする', () => {
    expect(
      toInitStats({
        months: [
          { month: '2024-08', count: 3412 },
          { month: '2023-12', count: 10 },
          { month: '2024-01', count: 5 },
        ],
        worlds: 128,
        people: 512,
      }),
    ).toEqual({
      photos: 3427,
      worlds: 128,
      people: 512,
      months: [
        { month: '2023-12', count: 10 },
        { month: '2024-01', count: 5 },
        { month: '2024-08', count: 3412 },
      ],
    });
  });

  it('写真が無ければ空の月別と 0 枚を返す', () => {
    expect(toInitStats({ months: [], worlds: 0, people: 0 })).toEqual({
      photos: 0,
      worlds: 0,
      people: 0,
      months: [],
    });
  });
});
