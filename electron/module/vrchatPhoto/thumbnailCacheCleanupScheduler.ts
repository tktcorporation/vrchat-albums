import { Cause, Effect } from 'effect';

import { logger } from '../../lib/logger';
import { cleanupThumbnailCache } from './vrchatPhoto.service';

/**
 * 起動直後は写真の読み込みとサムネイル生成でディスク I/O が混むため、落ち着いてから初回を走らせる
 */
const INITIAL_DELAY_MS = 1000 * 60 * 5;

/** ウィンドウを閉じて常駐し続ける場合にも上限を保つための、2 回目以降の間隔（24 時間） */
const INTERVAL_MS = 1000 * 60 * 60 * 24;

let initialTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * クリーンアップを 1 回走らせる。前回がまだ終わっていなければ重ねずに見送る。
 * 失敗はログに残すだけで、呼び出し元へは伝えない。
 */
const runCleanup = async (): Promise<void> => {
  if (isRunning) {
    return;
  }
  isRunning = true;
  const exit = await Effect.runPromiseExit(
    Effect.tryPromise({
      try: () => cleanupThumbnailCache(),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    }),
  );
  isRunning = false;
  if (exit._tag === 'Failure') {
    const error = Cause.squash(exit.cause);
    logger.warn({
      message: 'Thumbnail cache cleanup failed',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
  }
};

/**
 * サムネイルキャッシュの定期クリーンアップを始める。
 * 何度呼んでもタイマーは 1 組だけにする。タイマーはプロセスの終了を妨げない。
 */
export const startThumbnailCacheCleanupScheduler = (): void => {
  if (initialTimer !== null || intervalTimer !== null) {
    return;
  }
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void runCleanup();
    intervalTimer = setInterval(() => {
      void runCleanup();
    }, INTERVAL_MS);
    intervalTimer.unref?.();
  }, INITIAL_DELAY_MS);
  initialTimer.unref?.();
};

/** テスト用：タイマーを止めて、もう一度始められる状態に戻す */
export const resetThumbnailCacheCleanupSchedulerForTest = (): void => {
  if (initialTimer !== null) {
    clearTimeout(initialTimer);
  }
  if (intervalTimer !== null) {
    clearInterval(intervalTimer);
  }
  initialTimer = null;
  intervalTimer = null;
  isRunning = false;
};

export const THUMBNAIL_CACHE_CLEANUP_SCHEDULE = {
  initialDelayMs: INITIAL_DELAY_MS,
  intervalMs: INTERVAL_MS,
} as const;
