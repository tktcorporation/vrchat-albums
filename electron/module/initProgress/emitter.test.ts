import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventEmitter } from '../../trpc';
import { getPhotoCountPerLocalMonth } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import { countDistinctPlayerNames } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { countDistinctVisitedWorlds } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import {
  beginInitProgressRun,
  getInitProgressReplay,
  type InitProgressRun,
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

vi.mock('../vrchatPhoto/model/vrchatPhotoPath.model', () => ({
  getPhotoCountPerLocalMonth: vi.fn(),
}));

vi.mock('../VRChatPlayerJoinLogModel/playerJoinInfoLog.model', () => ({
  countDistinctPlayerNames: vi.fn(),
}));

vi.mock('../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model', () => ({
  countDistinctVisitedWorlds: vi.fn(),
}));

/** DB のモックが返す値から集計される統計 */
const stats: InitStats = {
  photos: 3,
  worlds: 2,
  people: 5,
  months: [
    { month: '2024-07', count: 1 },
    { month: '2024-08', count: 2 },
  ],
};

const syncLaunch = { syncMode: 'incremental', isFirstLaunch: false } as const;

/** マイクロタスクを流して、実行中の集計の完了処理を進める */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** 統計の間引き（集計の終了から 100ms）より長く待つ */
const waitForThrottle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  await settle();
};

/** 開いたハンドルを覚えておき、テスト後に確実に閉じる */
let opened: InitProgressRun[] = [];
const startup = (): InitProgressRun => {
  const run = beginInitProgressRun('startup', null);
  opened.push(run);
  return run;
};
const sync = (): InitProgressRun => {
  const run = beginInitProgressRun('sync', syncLaunch);
  opened.push(run);
  return run;
};

describe('init progress run handles', () => {
  let received: InitRunPayload[];
  const listener = (payload: InitRunPayload) => {
    received.push(payload);
  };
  const eventsOf = (run: { runId: number }) =>
    received.filter((p) => p.runId === run.runId);

  beforeEach(() => {
    vi.clearAllMocks();
    received = [];
    eventEmitter.on(INIT_PROGRESS_CHANNEL, listener);
    vi.mocked(getPhotoCountPerLocalMonth).mockResolvedValue([
      { month: '2024-08', count: 2 },
      { month: '2024-07', count: 1 },
    ]);
    vi.mocked(countDistinctVisitedWorlds).mockResolvedValue(2);
    vi.mocked(countDistinctPlayerNames).mockResolvedValue(5);
  });

  afterEach(() => {
    eventEmitter.off(INIT_PROGRESS_CHANNEL, listener);
    // 次のテストに実行を持ち越さない（閉じたハンドルの end は何もしない）
    for (const run of opened) {
      run.end('completed');
    }
    opened = [];
  });

  describe('ストリームの不変条件', () => {
    it('ステージの逆行と同一ステージ内の後退を送らない', () => {
      const run = startup();
      run.stage('log_load', 50);
      run.stage('log_load', 20);
      run.stage('log_append', 100);
      run.stage('photo_index', 10);

      expect(received.map((p) => [p.stage, p.progress])).toEqual([
        ['log_load', 50],
        ['log_load', 50],
        ['photo_index', 10],
      ]);
      for (const payload of received) {
        expect(InitRunPayloadSchema.safeParse(payload).success).toBe(true);
      }
    });

    it('起動種別は設定後のすべてのイベントに入り、終端イベントで実行が閉じる', () => {
      const run = startup();
      run.stage('database_sync', 100);
      run.setLaunch({ syncMode: 'incremental', isFirstLaunch: false });
      run.stage('log_append', 0);
      run.end('completed');

      expect(received.map((p) => p.launch)).toEqual([
        null,
        { syncMode: 'incremental', isFirstLaunch: false },
        { syncMode: 'incremental', isFirstLaunch: false },
      ]);
      expect(received.at(-1)).toMatchObject({
        stage: 'completed',
        progress: 100,
      });
      expect(new Set(received.map((p) => p.runId))).toEqual(
        new Set([run.runId]),
      );
      expect(getInitProgressReplay()).toBeNull();
    });

    it('error の終端イベントは最後の進捗を載せる', () => {
      const run = startup();
      run.stage('log_load', 30);
      run.end('error');

      expect(received.at(-1)).toMatchObject({ stage: 'error', progress: 30 });
    });

    it('実行ごとに runId が変わる', () => {
      const first = startup();
      first.stage('database_sync', 0);
      first.end('error');
      const second = startup();
      second.stage('database_sync', 0);

      expect(first.runId).toBeLessThan(second.runId);
      expect(received.map((p) => [p.runId, p.stage])).toEqual([
        [first.runId, 'database_sync'],
        [first.runId, 'error'],
        [second.runId, 'database_sync'],
      ]);
    });

    it('実行の種類はすべてのイベントに入る', () => {
      const run = sync();
      run.stage('log_append', 0);
      run.end('completed');

      expect(received.map((p) => p.kind)).toEqual(['sync', 'sync']);
      expect(received.every((p) => p.launch?.syncMode === 'incremental')).toBe(
        true,
      );
    });
  });

  describe('統計と実件数', () => {
    it('ステージ送信前の統計は保持し、ステージ送信後は現在地と一緒に送る', async () => {
      const run = startup();
      await run.flushStats();
      expect(received).toEqual([]);

      run.stage('database_sync', 100);
      await run.flushStats();
      expect(received.at(-1)).toMatchObject({
        stage: 'database_sync',
        progress: 100,
        stats,
      });
    });

    it('再送用の最新状態は最後の進捗と最新の統計を合わせたもの', async () => {
      const run = startup();
      run.setLaunch({ syncMode: 'full', isFirstLaunch: true });
      await run.flushStats();
      run.stage('photo_index', 40, {
        current: 4,
        total: 10,
        unit: 'photos',
        currentItem: '2024-08',
      });

      expect(getInitProgressReplay()).toMatchObject({
        runId: run.runId,
        stage: 'photo_index',
        progress: 40,
        details: { current: 4, total: 10 },
        launch: { syncMode: 'full', isFirstLaunch: true },
        stats,
      });
    });

    it('統計だけのイベントと再送は、現在のステージの実件数を保つ', async () => {
      const run = startup();
      const details = {
        current: 3412,
        total: 8900,
        unit: 'photos' as const,
        currentItem: '2024-08',
      };
      run.stage('photo_index', 38, details);
      await run.flushStats();
      // 同じステージで details を省いた進捗も、直前の実件数を載せる
      run.stage('photo_index', 39);

      expect(received.map((p) => p.details)).toEqual([
        details,
        details,
        details,
      ]);
      expect(received[1]).toMatchObject({ stage: 'photo_index', stats });
      expect(getInitProgressReplay()).toMatchObject({
        stage: 'photo_index',
        progress: 39,
        details,
        stats,
      });
    });

    it('ステージが変わったら前のステージの実件数を載せない', async () => {
      const run = startup();
      run.stage('photo_index', 100, {
        current: 10,
        total: 10,
        unit: 'photos',
      });
      run.stage('photo_metadata', 0);
      await run.flushStats();

      expect(received[1].details).toBeUndefined();
      expect(received[2].details).toBeUndefined();
      expect(getInitProgressReplay()?.details).toBeUndefined();
    });

    it('DB 登録の通知で統計を集計し直して送る', async () => {
      const run = startup();
      run.stage('log_load', 100);
      run.dbUpdated({ logsChanged: true });
      await waitForThrottle();

      expect(received.at(-1)).toMatchObject({ stage: 'log_load', stats });
    });
  });

  describe('実行の終了と種類', () => {
    it('A で始めた集計が、A の終了と B の開始の後に終わっても、B のイベントにも再送にも載らない', async () => {
      let resolveMonths: (
        months: { month: string; count: number }[],
      ) => void = () => {};
      vi.mocked(getPhotoCountPerLocalMonth).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveMonths = resolve;
        }),
      );
      const a = startup();
      a.stage('database_sync', 100);
      const flushingA = a.flushStats();
      await settle();
      a.end('error');

      const b = startup();
      b.stage('database_sync', 100);
      resolveMonths([{ month: '2024-08', count: 2 }]);
      await flushingA;
      await settle();

      expect(received.filter((p) => p.stats !== undefined)).toEqual([]);
      expect(eventsOf(a).map((p) => p.stage)).toEqual([
        'database_sync',
        'error',
      ]);
      expect(eventsOf(b).map((p) => p.stage)).toEqual(['database_sync']);
      expect(getInitProgressReplay()).toMatchObject({ runId: b.runId });
      expect(getInitProgressReplay()?.stats).toBeUndefined();
    });

    it('終えたハンドルへの操作はすべて何もしない', async () => {
      const run = startup();
      run.stage('database_sync', 100);
      run.end('completed');
      const sent = received.length;

      run.stage('log_append', 10);
      run.setLaunch({ syncMode: 'full', isFirstLaunch: true });
      run.dbUpdated({ logsChanged: true });
      await run.flushStats();
      run.end('error');
      await waitForThrottle();

      expect(received).toHaveLength(sent);
      expect(getPhotoCountPerLocalMonth).not.toHaveBeenCalled();
      expect(getInitProgressReplay()).toBeNull();
    });

    it('単独の同期の実行は DB を数えない', async () => {
      const run = sync();
      run.stage('log_append', 10);
      run.dbUpdated({ logsChanged: true });
      run.stage('log_append', 20);
      await run.flushStats();
      await waitForThrottle();

      expect(getPhotoCountPerLocalMonth).not.toHaveBeenCalled();
      expect(countDistinctVisitedWorlds).not.toHaveBeenCalled();
      expect(countDistinctPlayerNames).not.toHaveBeenCalled();
      expect(received).toHaveLength(2);
      expect(received.every((p) => p.stats === undefined)).toBe(true);
      expect(getInitProgressReplay()?.stats).toBeUndefined();
    });
  });
});
