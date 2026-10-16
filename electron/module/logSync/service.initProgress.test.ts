import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventEmitter } from '../../trpc';
import {
  beginInitProgressRun,
  getInitProgressReplay,
} from '../initProgress/emitter';
import {
  INIT_PROGRESS_CHANNEL,
  type InitRunPayload,
} from '../initProgress/schema';
import { loadLogInfoIndexFromVRChatLog } from '../logInfo/service';
import { appendLoglinesToFileFromLogFilePathList } from '../vrchatLog/vrchatLogController';
import {
  LOG_SYNC_MODE,
  runWithLogSyncLock,
  syncLogs,
  syncLogsHoldingLock,
} from './service';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../logInfo/service', () => ({
  loadLogInfoIndexFromVRChatLog: vi.fn(),
}));

vi.mock('../vrchatLog/vrchatLogController', () => ({
  appendLoglinesToFileFromLogFilePathList: vi.fn(),
}));

vi.mock('../initProgress/stats', () => ({
  createInitStatsCollector: vi.fn(() => ({
    request: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
  })),
}));

vi.mock('../worldJoinImage/service', () => ({
  generateMissingWorldJoinImages: vi.fn(() => Effect.succeed([])),
}));

vi.mock('../settingStore', () => ({
  getSettingStore: vi.fn(() => ({
    getWorldJoinImageGenerationEnabled: vi.fn(() => false),
    getVRChatPhotoDir: vi.fn(() => null),
  })),
}));

vi.mock('../vrchatPhoto/vrchatPhoto.service', () => ({
  getVRChatPhotoDirPath: vi.fn(() => ({ value: '/tmp/photos' })),
}));

const appendResult = {
  processedLogLines: [],
  totalProcessed: 0,
} as unknown as Awaited<
  ReturnType<typeof appendLoglinesToFileFromLogFilePathList>
>;

const waitTicks = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('進捗ストリームの実行とログ同期のセマフォ', () => {
  let received: InitRunPayload[];
  const listener = (payload: InitRunPayload) => {
    received.push(payload);
  };

  beforeEach(() => {
    received = [];
    eventEmitter.on(INIT_PROGRESS_CHANNEL, listener);
    vi.mocked(appendLoglinesToFileFromLogFilePathList).mockResolvedValue(
      appendResult,
    );
    vi.mocked(loadLogInfoIndexFromVRChatLog).mockReturnValue(
      Effect.succeed([]) as unknown as ReturnType<
        typeof loadLogInfoIndexFromVRChatLog
      >,
    );
  });

  afterEach(() => {
    eventEmitter.off(INIT_PROGRESS_CHANNEL, listener);
  });

  it('初期化の実行中に始まった単独の同期は、初期化の実行を置き換えも終了もしない', async () => {
    let initRunId = 0;
    let standalone: Promise<unknown> = Promise.resolve();

    await runWithLogSyncLock(async (lock) => {
      const init = beginInitProgressRun('startup', null);
      initRunId = init.runId;
      init.stage('database_sync', 100);

      // 初期化の途中でバックグラウンド同期が要求される
      standalone = Effect.runPromise(syncLogs(LOG_SYNC_MODE.INCREMENTAL));
      await waitTicks();
      expect(getInitProgressReplay()).toMatchObject({
        runId: initRunId,
        kind: 'startup',
        stage: 'database_sync',
      });

      await Effect.runPromise(
        syncLogsHoldingLock(lock, LOG_SYNC_MODE.INCREMENTAL, init),
      );
      init.end('completed');
    });
    await standalone;

    const initEvents = received.filter((p) => p.runId === initRunId);
    const otherEvents = received.filter((p) => p.runId !== initRunId);

    // 初期化の実行は自分の completed で閉じ、その後に単独の同期の実行が始まる
    expect(initEvents.map((p) => p.stage)).toEqual([
      'database_sync',
      'log_append',
      'log_append',
      'completed',
    ]);
    expect(received.slice(0, initEvents.length)).toEqual(initEvents);
    expect(new Set(otherEvents.map((p) => p.runId)).size).toBe(1);
    expect(otherEvents.at(-1)).toMatchObject({ stage: 'completed' });
    expect(otherEvents[0].runId).toBeGreaterThan(initRunId);
    expect(new Set(initEvents.map((p) => p.kind))).toEqual(
      new Set(['startup']),
    );
    expect(new Set(otherEvents.map((p) => p.kind))).toEqual(new Set(['sync']));
    expect(getInitProgressReplay()).toBeNull();
  });
});
