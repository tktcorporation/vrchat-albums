import { describe, expect, it, vi } from 'vitest';

// useInitProgress が import する tRPC クライアントは electron の preload を要するため差し替える
vi.mock('../../../trpc', () => ({ trpcReact: {} }));

import {
  applyInitProgressEvent,
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
      kind: 'startup',
      stage: 'photo_index',
      progress: 38,
      launch,
      details,
    });
    const afterStats = reduceInitProgress(afterProgress, {
      runId: 1,
      kind: 'startup',
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
      kind: 'startup',
      stage: 'photo_index',
      progress: 100,
      launch,
      details,
    });
    expect(
      reduceInitProgress(afterProgress, {
        runId: 1,
        kind: 'startup',
        stage: 'photo_metadata',
        progress: 0,
        launch,
      }).details,
    ).toBeNull();
    expect(
      reduceInitProgress(afterProgress, {
        runId: 2,
        kind: 'startup',
        stage: 'photo_index',
        progress: 0,
        launch,
      }).details,
    ).toBeNull();
  });
});

describe('applyInitProgressEvent', () => {
  const launch = { syncMode: 'incremental' as const, isFirstLaunch: false };

  it('起動時の初期化だけを見るとき、接続時に再送された単独の同期の現在地では起動画面を動かさない', () => {
    // レンダラー起動時、単独の同期（runId 3）がロックを持っていて、その現在地が再送される
    const afterReplay = applyInitProgressEvent(
      initialInitProgressState,
      {
        runId: 3,
        kind: 'sync',
        stage: 'photo_index',
        progress: 80,
        launch,
        details: { current: 8, total: 10, unit: 'photos' },
      },
      'startup',
    );
    expect(afterReplay).toBe(initialInitProgressState);

    const afterSyncCompleted = applyInitProgressEvent(
      afterReplay,
      { runId: 3, kind: 'sync', stage: 'completed', progress: 100, launch },
      'startup',
    );
    expect(afterSyncCompleted).toBe(initialInitProgressState);

    // ロックが返った後に始まる起動時の初期化の実行は、そのまま反映される
    const afterStartup = applyInitProgressEvent(
      afterSyncCompleted,
      {
        runId: 4,
        kind: 'startup',
        stage: 'database_sync',
        progress: 0,
        launch: null,
      },
      'startup',
    );
    expect(afterStartup.latest?.runId).toBe(4);
    expect(afterStartup.shown).toEqual({ runId: 4, percent: 0 });
  });

  it('起動が終わった後の単独の同期は、起動画面の状態を同じ参照のまま残す', () => {
    const ready = applyInitProgressEvent(
      initialInitProgressState,
      { runId: 1, kind: 'startup', stage: 'completed', progress: 100, launch },
      'startup',
    );
    const afterSync = applyInitProgressEvent(
      ready,
      { runId: 2, kind: 'sync', stage: 'log_append', progress: 0, launch },
      'startup',
    );
    expect(afterSync).toBe(ready);
  });

  it('種類を指定しなければ単独の同期の進捗も反映する', () => {
    const next = applyInitProgressEvent(
      initialInitProgressState,
      { runId: 2, kind: 'sync', stage: 'log_append', progress: 50, launch },
      undefined,
    );
    expect(next.latest).toMatchObject({ runId: 2, stage: 'log_append' });
  });
});
