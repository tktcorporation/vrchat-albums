import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventEmitter } from '../../trpc';
import {
  beginInitProgressRun,
  emitInitStats,
  emitStageProgress,
  endInitProgressRun,
  getInitProgressReplay,
  hasActiveInitProgressRun,
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
    endInitProgressRun('completed');
  });

  it('実行が無いときは何も送らない', () => {
    endInitProgressRun('completed');
    received = [];
    emitStageProgress('log_append', 10);
    expect(received).toEqual([]);
    expect(hasActiveInitProgressRun()).toBe(false);
  });

  it('ステージの逆行と同一ステージ内の後退を送らない', () => {
    beginInitProgressRun({ syncMode: 'full', isFirstLaunch: true });
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
    beginInitProgressRun(null);
    emitStageProgress('database_sync', 100);
    setInitProgressLaunch({ syncMode: 'incremental', isFirstLaunch: false });
    emitStageProgress('log_append', 0);
    endInitProgressRun('completed');

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
    expect(hasActiveInitProgressRun()).toBe(false);
  });

  it('実行ごとに runId が変わる', () => {
    beginInitProgressRun(null);
    emitStageProgress('database_sync', 0);
    endInitProgressRun('error');
    beginInitProgressRun(null);
    emitStageProgress('database_sync', 0);

    const runIds = received.map((p) => p.runId);
    expect(runIds[0]).toBeLessThan(runIds[2]);
    expect(received[1]).toMatchObject({ stage: 'error' });
  });

  it('ステージ送信前の統計は保持し、ステージ送信後は現在地と一緒に送る', () => {
    beginInitProgressRun(null);
    emitInitStats(stats);
    expect(received).toEqual([]);

    emitStageProgress('database_sync', 100);
    emitInitStats(stats);
    expect(received.at(-1)).toMatchObject({
      stage: 'database_sync',
      progress: 100,
      stats,
    });
  });

  it('再送用の最新状態は最後の進捗と最新の統計を合わせたもの', () => {
    beginInitProgressRun({ syncMode: 'full', isFirstLaunch: true });
    emitInitStats(stats);
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
    endInitProgressRun('completed');
    expect(getInitProgressReplay()).toBeNull();
  });
});
