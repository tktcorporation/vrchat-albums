import { describe, expect, it, vi } from 'vitest';

// useInitProgress が import する tRPC クライアントは electron の preload を要するため差し替える
vi.mock('../../../trpc', () => ({ trpcReact: {} }));

import {
  initialInitProgressState,
  nextShownOverallProgress,
  reduceInitProgress,
} from '../useInitProgress';

describe('nextShownOverallProgress', () => {
  it('ステージの重みで全体進捗を計算する', () => {
    // database_sync(10) + log_append(15) を終え、log_load(25) の半分
    expect(
      nextShownOverallProgress(null, {
        runId: 1,
        stage: 'log_load',
        progress: 50,
      }),
    ).toEqual({ runId: 1, percent: 38 });
  });

  it('同じ実行の中では前回表示した値より小さくしない', () => {
    const shown = { runId: 1, percent: 60 };
    expect(
      nextShownOverallProgress(shown, {
        runId: 1,
        stage: 'log_load',
        progress: 0,
      }),
    ).toEqual({ runId: 1, percent: 60 });
  });

  it('送られなかったステージは後ろのステージが届いた時点で完了扱いになる', () => {
    expect(
      nextShownOverallProgress(null, {
        runId: 1,
        stage: 'photo_log_import',
        progress: 0,
      }),
    ).toEqual({ runId: 1, percent: 95 });
  });

  it('completed は 100%、error はその時点の値を保つ', () => {
    const shown = { runId: 1, percent: 42 };
    expect(
      nextShownOverallProgress(shown, {
        runId: 1,
        stage: 'completed',
        progress: 100,
      }).percent,
    ).toBe(100);
    expect(
      nextShownOverallProgress(shown, { runId: 1, stage: 'error', progress: 0 })
        .percent,
    ).toBe(42);
  });

  it('新しい実行が始まったら 0 から数え直す', () => {
    const shown = { runId: 1, percent: 100 };
    expect(
      nextShownOverallProgress(shown, {
        runId: 2,
        stage: 'log_append',
        progress: 0,
      }),
    ).toEqual({ runId: 2, percent: 10 });
  });

  it('progress が単調に増える列を流すと全体進捗も単調に増える', () => {
    const events = [
      ['database_sync', 0],
      ['database_sync', 100],
      ['log_append', 50],
      ['log_append', 100],
      ['log_load', 40],
      ['log_load', 100],
      ['photo_index', 10],
      ['photo_index', 100],
      ['photo_metadata', 100],
      ['photo_log_import', 100],
      ['completed', 100],
    ] as const;
    let shown = null;
    const percents: number[] = [];
    for (const [stage, progress] of events) {
      shown = nextShownOverallProgress(shown, { runId: 1, stage, progress });
      percents.push(shown.percent);
    }
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(100);
  });
});

describe('reduceInitProgress', () => {
  const details = {
    current: 3412,
    total: 8900,
    unit: 'photos' as const,
    currentItem: '2024-08',
  };
  const stats = {
    photos: 1,
    worlds: 1,
    people: 1,
    months: [{ month: '2024-08', count: 1 }],
  };
  const launch = { syncMode: 'full' as const, isFirstLaunch: true };

  it('同じ実行・同じステージで details の無いイベントが来ても直前の実件数を残す', () => {
    const afterProgress = reduceInitProgress(initialInitProgressState, {
      runId: 1,
      stage: 'photo_index',
      progress: 38,
      launch,
      details,
    });
    const afterStats = reduceInitProgress(afterProgress, {
      runId: 1,
      stage: 'photo_index',
      progress: 38,
      launch,
      stats,
    });
    expect(afterStats.details).toEqual(details);
    expect(afterStats.stats).toEqual(stats);
  });

  it('ステージか実行が変わったら直前の実件数を捨てる', () => {
    const afterProgress = reduceInitProgress(initialInitProgressState, {
      runId: 1,
      stage: 'photo_index',
      progress: 100,
      launch,
      details,
    });
    expect(
      reduceInitProgress(afterProgress, {
        runId: 1,
        stage: 'photo_metadata',
        progress: 0,
        launch,
      }).details,
    ).toBeNull();
    expect(
      reduceInitProgress(afterProgress, {
        runId: 2,
        stage: 'photo_index',
        progress: 0,
        launch,
      }).details,
    ).toBeNull();
  });
});
