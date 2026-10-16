import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginInitProgressRun,
  endInitProgressRun,
  hasActiveInitProgressRun,
} from '../initProgress/emitter';
import { loadLogInfoIndexFromVRChatLog } from '../logInfo/service';
import { appendLoglinesToFileFromLogFilePathList } from '../vrchatLog/vrchatLogController';
import { LOG_SYNC_MODE, syncLogs } from './service';

vi.mock('../logInfo/service', () => ({
  loadLogInfoIndexFromVRChatLog: vi.fn(),
}));

vi.mock('../vrchatLog/vrchatLogController', () => ({
  appendLoglinesToFileFromLogFilePathList: vi.fn(),
}));

vi.mock('../initProgress/emitter', () => ({
  beginInitProgressRun: vi.fn(),
  emitStageProgress: vi.fn(),
  endInitProgressRun: vi.fn(),
  hasActiveInitProgressRun: vi.fn(() => false),
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
      vi.mocked(hasActiveInitProgressRun).mockReturnValue(false);
      mockAppend.mockResolvedValue(appendResult);
      succeedLoad();

      await Effect.runPromise(syncLogs(LOG_SYNC_MODE.FULL));

      expect(beginInitProgressRun).toHaveBeenCalledWith({
        syncMode: 'full',
        isFirstLaunch: false,
      });
      expect(endInitProgressRun).toHaveBeenCalledWith('completed');
    });

    it('単独で呼ばれて失敗したときは error として終える', async () => {
      vi.mocked(hasActiveInitProgressRun).mockReturnValue(false);
      mockAppend.mockRejectedValue(new Error('read failed'));

      await Effect.runPromiseExit(syncLogs(LOG_SYNC_MODE.INCREMENTAL));

      expect(beginInitProgressRun).toHaveBeenCalledWith({
        syncMode: 'incremental',
        isFirstLaunch: false,
      });
      expect(endInitProgressRun).toHaveBeenCalledWith('error');
    });

    it('初期化の実行中に呼ばれたときは実行を開始も終了もしない', async () => {
      vi.mocked(hasActiveInitProgressRun).mockReturnValue(true);
      mockAppend.mockResolvedValue(appendResult);
      succeedLoad();

      await Effect.runPromise(syncLogs(LOG_SYNC_MODE.INCREMENTAL));

      expect(beginInitProgressRun).not.toHaveBeenCalled();
      expect(endInitProgressRun).not.toHaveBeenCalled();
    });
  });
});
