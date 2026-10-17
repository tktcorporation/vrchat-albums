import { EventEmitter } from 'node:events';

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TERMS_VERSION } from '../../../src/v2/constants/terms/version';
import type { SettingStore } from '../settingStore';
import { getSettingStore } from '../settingStore';
import { logSyncRouter } from './logSyncController';
import { LOG_SYNC_MODE, syncLogs } from './service';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../settingStore', () => ({
  getSettingStore: vi.fn(),
}));

vi.mock('./service', () => ({
  LOG_SYNC_MODE: {
    FULL: 'FULL',
    INCREMENTAL: 'INCREMENTAL',
  },
  syncLogs: vi.fn(),
}));

const storeOf = (accepted: boolean, version: string): SettingStore =>
  ({
    getTermsAccepted: () => accepted,
    getTermsVersion: () => version,
  }) as unknown as SettingStore;

const callSyncLogs = () =>
  logSyncRouter()
    .createCaller({ eventEmitter: new EventEmitter() })
    .syncLogs({ mode: LOG_SYNC_MODE.INCREMENTAL });

describe('logSyncController.syncLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(syncLogs).mockReturnValue(
      Effect.succeed({
        createdWorldJoinLogModelList: [],
        createdPlayerJoinLogModelList: [],
        createdPlayerLeaveLogModelList: [],
        createdVRChatPhotoPathModelList: [],
      }) as unknown as ReturnType<typeof syncLogs>,
    );
  });

  it('現在の版の利用規約に同意済みなら同期する', async () => {
    vi.mocked(getSettingStore).mockReturnValue(storeOf(true, TERMS_VERSION));

    await expect(callSyncLogs()).resolves.toBe(true);
    expect(syncLogs).toHaveBeenCalledWith(LOG_SYNC_MODE.INCREMENTAL);
  });

  it('利用規約に未同意なら同期せずに拒む', async () => {
    vi.mocked(getSettingStore).mockReturnValue(storeOf(false, TERMS_VERSION));

    await expect(callSyncLogs()).rejects.toThrow(
      '利用規約に同意してから操作してください',
    );
    expect(syncLogs).not.toHaveBeenCalled();
  });

  it('古い版の規約にしか同意していなければ同期せずに拒む', async () => {
    vi.mocked(getSettingStore).mockReturnValue(storeOf(true, '0.0'));

    await expect(callSyncLogs()).rejects.toThrow(
      '利用規約に同意してから操作してください',
    );
    expect(syncLogs).not.toHaveBeenCalled();
  });
});
