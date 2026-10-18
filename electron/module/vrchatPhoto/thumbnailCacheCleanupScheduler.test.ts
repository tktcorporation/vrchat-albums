import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../lib/logger';
import {
  resetThumbnailCacheCleanupSchedulerForTest,
  startThumbnailCacheCleanupScheduler,
  THUMBNAIL_CACHE_CLEANUP_SCHEDULE,
} from './thumbnailCacheCleanupScheduler';
import { cleanupThumbnailCache } from './vrchatPhoto.service';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./vrchatPhoto.service', () => ({
  cleanupThumbnailCache: vi.fn(),
}));

const { initialDelayMs, intervalMs } = THUMBNAIL_CACHE_CLEANUP_SCHEDULE;

describe('startThumbnailCacheCleanupScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(cleanupThumbnailCache).mockReset();
    vi.mocked(cleanupThumbnailCache).mockResolvedValue(undefined);
    vi.mocked(logger.warn).mockReset();
  });

  afterEach(() => {
    resetThumbnailCacheCleanupSchedulerForTest();
    vi.useRealTimers();
  });

  it('起動直後には走らせず、初回の遅延後に 1 回走らせる', async () => {
    startThumbnailCacheCleanupScheduler();

    await vi.advanceTimersByTimeAsync(initialDelayMs - 1);
    expect(cleanupThumbnailCache).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(cleanupThumbnailCache).toHaveBeenCalledTimes(1);
  });

  it('初回の後は間隔ごとに走らせる', async () => {
    startThumbnailCacheCleanupScheduler();
    await vi.advanceTimersByTimeAsync(initialDelayMs + intervalMs * 2);

    expect(cleanupThumbnailCache).toHaveBeenCalledTimes(3);
  });

  it('何度呼んでもタイマーは 1 組だけにする', async () => {
    startThumbnailCacheCleanupScheduler();
    startThumbnailCacheCleanupScheduler();
    await vi.advanceTimersByTimeAsync(initialDelayMs);

    expect(cleanupThumbnailCache).toHaveBeenCalledTimes(1);
  });

  it('前回が終わっていなければ重ねて走らせない', async () => {
    vi.mocked(cleanupThumbnailCache).mockReturnValue(new Promise(() => {}));
    startThumbnailCacheCleanupScheduler();
    await vi.advanceTimersByTimeAsync(initialDelayMs + intervalMs);

    expect(cleanupThumbnailCache).toHaveBeenCalledTimes(1);
  });

  it('クリーンアップが失敗してもログに残して次回も走らせる', async () => {
    vi.mocked(cleanupThumbnailCache)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    startThumbnailCacheCleanupScheduler();

    await vi.advanceTimersByTimeAsync(initialDelayMs);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(intervalMs);
    expect(cleanupThumbnailCache).toHaveBeenCalledTimes(2);
  });
});
