import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../lib/logger';
import { getPhotoCountPerLocalMonth } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import { countDistinctPlayerNames } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { countDistinctVisitedWorlds } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import {
  createInitStatsCollector,
  createThrottledRunner,
  toInitStats,
} from './stats';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../vrchatPhoto/model/vrchatPhotoPath.model', () => ({
  getPhotoCountPerLocalMonth: vi.fn(),
}));

vi.mock('../VRChatPlayerJoinLogModel/playerJoinInfoLog.model', () => ({
  countDistinctPlayerNames: vi.fn(),
}));

vi.mock('../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model', () => ({
  countDistinctVisitedWorlds: vi.fn(),
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

  it('実行中に来た要求は、終わってから間隔を空けてもう 1 回実行して取りこぼさない', async () => {
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
    // 開始から 150ms 経っていても、終了からはまだ間隔が空いていない
    expect(task).toHaveBeenCalledTimes(1);

    advance(99);
    expect(task).toHaveBeenCalledTimes(1);
    advance(1);
    await settle();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('集計が遅くても、終了から次の開始まで必ず間隔を空ける', async () => {
    const { timers, advance } = createManualTimers();
    const starts: number[] = [];
    const finishes: number[] = [];
    let finish: () => void = () => {};
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          starts.push(timers.now());
          finish = () => {
            finishes.push(timers.now());
            resolve();
          };
        }),
    );
    const runner = createThrottledRunner(task, 100, timers);

    // 1 回の集計に 80ms かかり、その間も要求が来続ける
    for (let elapsed = 0; elapsed < 1000; elapsed += 10) {
      runner.request();
      if (task.mock.calls.length > finishes.length && elapsed % 80 === 0) {
        finish();
      }
      advance(10);
      await settle();
    }

    expect(starts.length).toBeGreaterThan(2);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - finishes[i - 1]).toBeGreaterThanOrEqual(100);
    }
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

  it('flush は実行中のものを待ってから実行し、待っている間の要求で余分に実行しない', async () => {
    const { timers, advance } = createManualTimers();
    let finish: () => void = () => {};
    let calls = 0;
    const task = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve();
    });
    const runner = createThrottledRunner(task, 100, timers);

    runner.request();
    const flushed = runner.flush();
    runner.request();
    finish();
    await flushed;
    expect(task).toHaveBeenCalledTimes(2);

    advance(500);
    await settle();
    expect(task).toHaveBeenCalledTimes(2);
  });
  it('close の後は予約していた実行も、新しい要求も実行しない', async () => {
    const { timers, advance } = createManualTimers();
    const task = vi.fn(() => Promise.resolve());
    const runner = createThrottledRunner(task, 100, timers);

    runner.request();
    await settle();
    runner.request(); // 間隔内なので予約される
    runner.close();
    advance(500);
    runner.request();
    await settle();

    expect(task).toHaveBeenCalledTimes(1);
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

describe('統計のコレクター', () => {
  const waitForThrottle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await settle();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPhotoCountPerLocalMonth).mockResolvedValue([
      { month: '2024-08', count: 2 },
    ]);
    vi.mocked(countDistinctVisitedWorlds).mockResolvedValue(3);
    vi.mocked(countDistinctPlayerNames).mockResolvedValue(4);
  });

  it('数えた値を届け先へ渡す', async () => {
    const deliver = vi.fn();
    const collector = createInitStatsCollector(deliver);

    await collector.flush();

    expect(deliver).toHaveBeenCalledWith({
      photos: 2,
      worlds: 3,
      people: 4,
      months: [{ month: '2024-08', count: 2 }],
    });
    collector.close();
  });

  it('写真の登録中の要求ではワールド数・人数を数え直さず、ログの登録後と区切りでだけ数え直す', async () => {
    const deliver = vi.fn();
    const collector = createInitStatsCollector(deliver);

    await collector.flush();
    collector.request({ logsChanged: false });
    await waitForThrottle();

    expect(getPhotoCountPerLocalMonth).toHaveBeenCalledTimes(2);
    expect(countDistinctVisitedWorlds).toHaveBeenCalledTimes(1);
    expect(countDistinctPlayerNames).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenLastCalledWith(
      expect.objectContaining({ worlds: 3, people: 4 }),
    );

    collector.request({ logsChanged: true });
    await waitForThrottle();

    expect(countDistinctVisitedWorlds).toHaveBeenCalledTimes(2);
    expect(countDistinctPlayerNames).toHaveBeenCalledTimes(2);

    await collector.flush();

    expect(countDistinctVisitedWorlds).toHaveBeenCalledTimes(3);
    collector.close();
  });

  it('集計中にログが登録されたら、その集計が数えたワールド数・人数を次の集計で使い回さない', async () => {
    const deliver = vi.fn();
    const collector = createInitStatsCollector(deliver);
    let resolveSlowWorlds: (worlds: number) => void = () => {};
    const slowWorlds = new Promise<number>((resolve) => {
      resolveSlowWorlds = resolve;
    });
    vi.mocked(countDistinctVisitedWorlds).mockReturnValueOnce(slowWorlds);

    const firstFlush = collector.flush();
    await settle();
    // ログ同期の結果を登録した。集計中の値は登録前のログを数えている
    collector.request({ logsChanged: true });
    vi.mocked(countDistinctVisitedWorlds).mockResolvedValue(7);
    resolveSlowWorlds(3);
    await firstFlush;
    await waitForThrottle();

    expect(countDistinctVisitedWorlds).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenLastCalledWith(
      expect.objectContaining({ worlds: 7 }),
    );
    collector.close();
  });

  it('ワールド数・人数の数え直しに失敗したら、次の集計で改めて数え直す', async () => {
    const deliver = vi.fn();
    const collector = createInitStatsCollector(deliver);

    await collector.flush();
    vi.mocked(countDistinctVisitedWorlds).mockRejectedValueOnce(
      new Error('busy'),
    );
    vi.mocked(countDistinctVisitedWorlds).mockResolvedValue(9);
    collector.request({ logsChanged: true });
    await waitForThrottle();
    collector.request({ logsChanged: false });
    await waitForThrottle();

    expect(countDistinctVisitedWorlds).toHaveBeenCalledTimes(3);
    expect(deliver).toHaveBeenLastCalledWith(
      expect.objectContaining({ worlds: 9 }),
    );
    collector.close();
  });

  it('集計の失敗はコレクターごとに 1 回だけ error で報告し、同じコレクターの 2 回目以降は warn にする', async () => {
    vi.mocked(getPhotoCountPerLocalMonth).mockRejectedValue(
      new Error('database is locked'),
    );
    const deliver = vi.fn();
    const first = createInitStatsCollector(deliver);

    await first.flush();
    await first.flush();
    await first.flush();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(deliver).not.toHaveBeenCalled();
    first.close();

    const second = createInitStatsCollector(deliver);
    await second.flush();

    expect(logger.error).toHaveBeenCalledTimes(2);
    second.close();
  });
});
