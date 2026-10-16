import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginInitProgressRun,
  endInitProgressRun,
} from '../initProgress/emitter';
import { loadLogInfoIndexFromVRChatLog } from '../logInfo/service';
import { appendLoglinesToFileFromLogFilePathList } from '../vrchatLog/vrchatLogController';
import {
  LOG_SYNC_MODE,
  runWithLogSyncLock,
  syncLogs,
  syncLogsHoldingLock,
} from './service';

vi.mock('../logInfo/service', () => ({
  loadLogInfoIndexFromVRChatLog: vi.fn(),
}));

vi.mock('../vrchatLog/vrchatLogController', () => ({
  appendLoglinesToFileFromLogFilePathList: vi.fn(),
}));

vi.mock('../initProgress/emitter', () => ({
  beginInitProgressRun: vi.fn(() => 7),
  emitStageProgress: vi.fn(),
  endInitProgressRun: vi.fn(),
}));

vi.mock('../initProgress/stats', () => ({
  flushInitStats: vi.fn(() => Promise.resolve()),
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

const mockAppend = vi.mocked(appendLoglinesToFileFromLogFilePathList);
const mockLoadLogInfo = vi.mocked(loadLogInfoIndexFromVRChatLog);

const appendResult = {
  processedLogLines: [],
  totalProcessed: 0,
} as unknown as Awaited<
  ReturnType<typeof appendLoglinesToFileFromLogFilePathList>
>;

describe('syncLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appendLoglines の後に loadLogInfo を呼ぶ', async () => {
    mockAppend.mockResolvedValue(appendResult);
    mockLoadLogInfo.mockReturnValue(
      Effect.succeed([]) as unknown as ReturnType<
        typeof loadLogInfoIndexFromVRChatLog
      >,
    );

    await Effect.runPromise(syncLogs(LOG_SYNC_MODE.INCREMENTAL));

    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(mockLoadLogInfo).toHaveBeenCalledTimes(1);
  });

  it('並行呼び出しはセマフォで直列化され append→load の順序が崩れない', async () => {
    // append 中に待機を挟む。直列化されていなければ待機中に2件目の append が割り込み、
    // 呼び出し順が [append, append, load, load] になる。
    const callOrder: string[] = [];
    mockAppend.mockImplementation(async () => {
      callOrder.push('append');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return appendResult;
    });
    mockLoadLogInfo.mockImplementation(
      () =>
        Effect.sync(() => {
          callOrder.push('load');
          return [];
        }) as unknown as ReturnType<typeof loadLogInfoIndexFromVRChatLog>,
    );

    await Promise.all([
      Effect.runPromise(syncLogs(LOG_SYNC_MODE.INCREMENTAL)),
      Effect.runPromise(syncLogs(LOG_SYNC_MODE.INCREMENTAL)),
    ]);

    expect(callOrder).toEqual(['append', 'load', 'append', 'load']);
  });

  describe('進捗ストリームの実行', () => {
    const succeedLoad = () =>
      mockLoadLogInfo.mockReturnValue(
        Effect.succeed([]) as unknown as ReturnType<
          typeof loadLogInfoIndexFromVRChatLog
        >,
      );

    it('単独で呼ばれたときは実行を開始し、成功で completed として終える', async () => {
      mockAppend.mockResolvedValue(appendResult);
      succeedLoad();

      await Effect.runPromise(syncLogs(LOG_SYNC_MODE.FULL));

      expect(beginInitProgressRun).toHaveBeenCalledWith({
        syncMode: 'full',
        isFirstLaunch: false,
      });
      expect(endInitProgressRun).toHaveBeenCalledWith(7, 'completed');
    });

    it('単独で呼ばれて失敗したときは error として終える', async () => {
      mockAppend.mockRejectedValue(new Error('read failed'));

      await Effect.runPromiseExit(syncLogs(LOG_SYNC_MODE.INCREMENTAL));

      expect(beginInitProgressRun).toHaveBeenCalledWith({
        syncMode: 'incremental',
        isFirstLaunch: false,
      });
      expect(endInitProgressRun).toHaveBeenCalledWith(7, 'error');
    });

    it('permit を持った呼び出し元からの同期は実行を開始も終了もしない', async () => {
      mockAppend.mockResolvedValue(appendResult);
      succeedLoad();

      await runWithLogSyncLock((lock) =>
        Effect.runPromise(syncLogsHoldingLock(lock, LOG_SYNC_MODE.INCREMENTAL)),
      );

      expect(mockAppend).toHaveBeenCalledTimes(1);
      expect(beginInitProgressRun).not.toHaveBeenCalled();
      expect(endInitProgressRun).not.toHaveBeenCalled();
    });
  });

  describe('runWithLogSyncLock', () => {
    it('permit を持っている間に呼ばれた syncLogs は、permit が返るまで始まらない', async () => {
      mockAppend.mockResolvedValue(appendResult);
      mockLoadLogInfo.mockReturnValue(
        Effect.succeed([]) as unknown as ReturnType<
          typeof loadLogInfoIndexFromVRChatLog
        >,
      );
      const order: string[] = [];
      let standalone: Promise<unknown> = Promise.resolve();

      await runWithLogSyncLock(async () => {
        order.push('lock:start');
        standalone = Effect.runPromise(
          syncLogs(LOG_SYNC_MODE.INCREMENTAL),
        ).then(() => {
          order.push('standalone:done');
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(beginInitProgressRun).not.toHaveBeenCalled();
        order.push('lock:end');
      });
      await standalone;

      expect(order).toEqual(['lock:start', 'lock:end', 'standalone:done']);
      expect(beginInitProgressRun).toHaveBeenCalledTimes(1);
    });

    it('task の reject をそのまま伝え、permit を返す', async () => {
      const failure = new Error('init failed');
      await expect(
        runWithLogSyncLock(() => Promise.reject(failure)),
      ).rejects.toBe(failure);

      mockAppend.mockResolvedValue(appendResult);
      mockLoadLogInfo.mockReturnValue(
        Effect.succeed([]) as unknown as ReturnType<
          typeof loadLogInfoIndexFromVRChatLog
        >,
      );
      await Effect.runPromise(syncLogs(LOG_SYNC_MODE.INCREMENTAL));
      expect(mockAppend).toHaveBeenCalledTimes(1);
    });
  });
});
