import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TERMS_VERSION } from '../../../src/v2/constants/terms/version';
import type { SettingStore } from '../settingStore';
import {
  resetBackgroundSyncTimerForTest,
  startBackgroundSyncTimer,
} from './backgroundTimer';
import { syncLogsInBackground } from './service';

vi.mock('../../lib/electronModules', () => ({
  getNotification: () => vi.fn(() => ({ show: vi.fn() })),
}));

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./service', () => ({
  syncLogsInBackground: vi.fn(),
}));

const SIX_HOURS_MS = 1000 * 60 * 60 * 6;

const storeOf = (overrides: {
  backgroundEnabled?: boolean;
  termsVersion?: string;
}): SettingStore =>
  ({
    getBackgroundFileCreateFlag: () => overrides.backgroundEnabled ?? true,
    getTermsAccepted: () => true,
    getTermsVersion: () => overrides.termsVersion ?? TERMS_VERSION,
  }) as unknown as SettingStore;

describe('startBackgroundSyncTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(syncLogsInBackground).mockReturnValue(
      Effect.succeed({
        createdVRChatPhotoPathModelList: [],
        createdWorldJoinLogModelList: [],
        createdPlayerJoinLogModelList: [],
      }) as unknown as ReturnType<typeof syncLogsInBackground>,
    );
  });

  afterEach(() => {
    resetBackgroundSyncTimerForTest();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('何度呼んでも、6 時間ごとの同期は 1 回だけ走る', async () => {
    const store = storeOf({});
    startBackgroundSyncTimer(store);
    startBackgroundSyncTimer(store);
    startBackgroundSyncTimer(store);

    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS);

    expect(syncLogsInBackground).toHaveBeenCalledTimes(1);
  });

  it('バックグラウンド処理が無効なら同期しない', async () => {
    startBackgroundSyncTimer(storeOf({ backgroundEnabled: false }));

    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS);

    expect(syncLogsInBackground).not.toHaveBeenCalled();
  });

  it('現在の版の利用規約に未同意なら同期しない', async () => {
    startBackgroundSyncTimer(storeOf({ termsVersion: '0.0' }));

    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS);

    expect(syncLogsInBackground).not.toHaveBeenCalled();
  });
});
