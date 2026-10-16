import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventEmitter } from '../../trpc';
import {
  beginInitProgressRun,
  emitInitStats,
  emitStageProgress,
  endInitProgressRun,
  getInitProgressReplay,
  getActiveInitProgressRun,
  setInitProgressLaunch,
} from './emitter';
import {
  INIT_PROGRESS_CHANNEL,
  type InitRunPayload,
  InitRunPayloadSchema,
  type InitStats,
} from './schema';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const stats: InitStats = {
  photos: 3,
  worlds: 2,
  people: 5,
  months: [
    { month: '2024-07', count: 1 },
    { month: '2024-08', count: 2 },
  ],
};

/** begin が返した ID を覚えておき、テスト後に確実に閉じる */
let openRunIds: number[] = [];
const begin = (...args: Parameters<typeof beginInitProgressRun>): number => {
  const runId = beginInitProgressRun(...args);
  openRunIds.push(runId);
  return runId;
};

describe('init progress emitter', () => {
  let received: InitRunPayload[];
  const listener = (payload: InitRunPayload) => {
    received.push(payload);
  };

  beforeEach(() => {
    received = [];
    eventEmitter.on(INIT_PROGRESS_CHANNEL, listener);
  });

  afterEach(() => {
    eventEmitter.off(INIT_PROGRESS_CHANNEL, listener);
    // 次のテストに実行状態を持ち越さない
    for (const runId of openRunIds) {
      endInitProgressRun(runId, 'completed');
    }
    openRunIds = [];
  });

  it('実行が無いときは何も送らない', () => {
    emitStageProgress('log_append', 10);
    expect(received).toEqual([]);
    expect(getActiveInitProgressRun()).toBeNull();
  });

  it('ステージの逆行と同一ステージ内の後退を送らない', () => {
    begin('startup', { syncMode: 'full', isFirstLaunch: true });
    emitStageProgress('log_load', 50);
    emitStageProgress('log_load', 20);
    emitStageProgress('log_append', 100);
    emitStageProgress('photo_index', 10);

    expect(received.map((p) => [p.stage, p.progress])).toEqual([
      ['log_load', 50],
      ['log_load', 50],
      ['photo_index', 10],
    ]);
    for (const payload of received) {
      expect(InitRunPayloadSchema.safeParse(payload).success).toBe(true);
    }
  });

  it('起動種別は判定後のすべてのイベントに入り、終端イベントで実行が閉じる', () => {
    const runId = begin('startup', null);
    emitStageProgress('database_sync', 100);
    setInitProgressLaunch({ syncMode: 'incremental', isFirstLaunch: false });
    emitStageProgress('log_append', 0);
    endInitProgressRun(runId, 'completed');

    expect(received.map((p) => p.launch)).toEqual([
      null,
      { syncMode: 'incremental', isFirstLaunch: false },
      { syncMode: 'incremental', isFirstLaunch: false },
    ]);
    expect(received.at(-1)).toMatchObject({
      stage: 'completed',
      progress: 100,
    });
    expect(new Set(received.map((p) => p.runId)).size).toBe(1);
    expect(getActiveInitProgressRun()).toBeNull();
  });

  it('実行ごとに runId が変わる', () => {
    const firstRunId = begin('startup', null);
    emitStageProgress('database_sync', 0);
    endInitProgressRun(firstRunId, 'error');
    begin('startup', null);
    emitStageProgress('database_sync', 0);

    const runIds = received.map((p) => p.runId);
    expect(runIds[0]).toBeLessThan(runIds[2]);
    expect(received[1]).toMatchObject({ stage: 'error' });
  });

  it('ステージ送信前の統計は保持し、ステージ送信後は現在地と一緒に送る', () => {
    begin('startup', null);
    emitInitStats(openRunIds.at(-1) ?? 0, stats);
    expect(received).toEqual([]);

    emitStageProgress('database_sync', 100);
    emitInitStats(openRunIds.at(-1) ?? 0, stats);
    expect(received.at(-1)).toMatchObject({
      stage: 'database_sync',
      progress: 100,
      stats,
    });
  });

  it('再送用の最新状態は最後の進捗と最新の統計を合わせたもの', () => {
    const runId = begin('startup', { syncMode: 'full', isFirstLaunch: true });
    emitInitStats(openRunIds.at(-1) ?? 0, stats);
    emitStageProgress('photo_index', 40, {
      current: 4,
      total: 10,
      unit: 'photos',
      currentItem: '2024-08',
    });

    expect(getInitProgressReplay()).toMatchObject({
      stage: 'photo_index',
      progress: 40,
      details: { current: 4, total: 10 },
      stats,
    });
    endInitProgressRun(runId, 'completed');
    expect(getInitProgressReplay()).toBeNull();
  });

  it('統計だけのイベントと再送は、現在のステージの実件数を保つ', () => {
    begin('startup', { syncMode: 'full', isFirstLaunch: true });
    const details = {
      current: 3412,
      total: 8900,
      unit: 'photos' as const,
      currentItem: '2024-08',
    };
    emitStageProgress('photo_index', 38, details);
    emitInitStats(openRunIds.at(-1) ?? 0, stats);
    // 同じステージで details を省いた進捗も、直前の実件数を載せる
    emitStageProgress('photo_index', 39);

    expect(received.map((p) => p.details)).toEqual([details, details, details]);
    expect(received[1]).toMatchObject({ stage: 'photo_index', stats });
    expect(getInitProgressReplay()).toMatchObject({
      stage: 'photo_index',
      progress: 39,
      details,
      stats,
    });
  });

  it('ステージが変わったら前のステージの実件数を載せない', () => {
    begin('startup', { syncMode: 'full', isFirstLaunch: true });
    emitStageProgress('photo_index', 100, {
      current: 10,
      total: 10,
      unit: 'photos',
    });
    emitStageProgress('photo_metadata', 0);
    emitInitStats(openRunIds.at(-1) ?? 0, stats);

    expect(received[1].details).toBeUndefined();
    expect(received[2].details).toBeUndefined();
    expect(getInitProgressReplay()?.details).toBeUndefined();
  });

  it('開始した実行の runId でなければ実行を閉じない', () => {
    const ownRunId = begin('startup', null);
    emitStageProgress('database_sync', 0);
    endInitProgressRun(ownRunId + 1, 'completed');

    expect(getActiveInitProgressRun()).not.toBeNull();
    expect(received.map((p) => p.stage)).toEqual(['database_sync']);

    endInitProgressRun(ownRunId, 'completed');
    expect(getActiveInitProgressRun()).toBeNull();
  });
  it('実行の種類はすべてのイベントに入る', () => {
    const runId = begin('sync', {
      syncMode: 'incremental',
      isFirstLaunch: false,
    });
    emitStageProgress('log_append', 0);
    endInitProgressRun(runId, 'completed');

    expect(received.map((p) => p.kind)).toEqual(['sync', 'sync']);
    expect(getActiveInitProgressRun()).toBeNull();
  });

  it('集計を始めた実行が終わっていたら、その統計を次の実行に混ぜない', () => {
    const failedRunId = begin('startup', null);
    emitStageProgress('database_sync', 100);
    endInitProgressRun(failedRunId, 'error');
    begin('startup', null);
    emitStageProgress('database_sync', 100);
    received.length = 0;

    emitInitStats(failedRunId, stats);

    expect(received).toEqual([]);
    expect(getInitProgressReplay()?.stats).toBeUndefined();
  });

  it('単独の同期の実行では統計を保持も送信もしない', () => {
    begin('sync', { syncMode: 'incremental', isFirstLaunch: false });
    emitStageProgress('log_append', 10);
    emitInitStats(openRunIds.at(-1) ?? 0, stats);
    emitStageProgress('log_append', 20);

    expect(received).toHaveLength(2);
    expect(received.every((p) => p.stats === undefined)).toBe(true);
    expect(getInitProgressReplay()?.stats).toBeUndefined();
  });
});
