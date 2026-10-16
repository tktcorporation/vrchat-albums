/**
 * 起動画面の統計（写真枚数・ワールド数・人数・月別枚数）を DB から集計し、進捗ストリームへ送る。
 *
 * 統計は毎回 DB から数え直す。インデックス中の写真を手元で足し込む方式だと、
 * 全件再スキャンで既存の写真を上書きしたときに二重に数えてしまうため。
 * 写真のバッチ登録ごとに集計を求められるので、集計の開始を INTERVAL_MS に 1 回までに間引く。
 */
import { Effect } from 'effect';

import { logger } from '../../lib/logger';
import { getPhotoCountPerLocalMonth } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import { countDistinctPlayerNames } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { countDistinctVisitedWorlds } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { emitInitStats, hasActiveInitProgressRun } from './emitter';
import type { InitStats } from './schema';

/** 統計の送信間隔の下限。1 秒あたり 10 回を超えて集計・送信しない */
const INTERVAL_MS = 100;

interface ThrottleTimers {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const realTimers: ThrottleTimers = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * 非同期タスクの開始を intervalMs に 1 回までに間引くランナー。
 *
 * - request: 間隔が空いていればすぐ実行し、空いていなければ間隔の終わりに 1 回だけ実行する。
 *   実行中に要求されたら、終わった後にもう 1 回実行する（最後の要求の結果が必ず反映される）
 * - flush: 予約を取り消し、実行中のものを待ってから、間隔に関係なく 1 回実行して完了を待つ
 *
 * @param task 失敗しても reject しないこと（失敗の扱いはタスク側の責務）
 */
export const createThrottledRunner = (
  task: () => Promise<void>,
  intervalMs: number,
  timers: ThrottleTimers = realTimers,
) => {
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let timer: unknown = null;
  let pendingAfterRun = false;

  const run = (): Promise<void> => {
    lastStartedAt = timers.now();
    const current = task().finally(() => {
      inFlight = null;
      if (pendingAfterRun) {
        pendingAfterRun = false;
        request();
      }
    });
    inFlight = current;
    return current;
  };

  const request = (): void => {
    if (inFlight) {
      pendingAfterRun = true;
      return;
    }
    if (timer !== null) {
      return;
    }
    const wait = lastStartedAt + intervalMs - timers.now();
    if (wait <= 0) {
      void run();
      return;
    }
    timer = timers.setTimer(() => {
      timer = null;
      request();
    }, wait);
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      timers.clearTimer(timer);
      timer = null;
    }
    pendingAfterRun = false;
    if (inFlight) {
      await inFlight;
    }
    await run();
  };

  return { request, flush };
};

/**
 * DB から数えた値を統計の形にまとめる。月は昇順に並べ、写真枚数は月別枚数の合計にする
 * （合計と内訳を別々に数えると、間に登録が挟まったときに食い違うため）。
 */
export const toInitStats = (input: {
  months: readonly { month: string; count: number }[];
  worlds: number;
  people: number;
}): InitStats => {
  const months = input.months
    .filter((m) => m.count > 0)
    .map((m) => ({ month: m.month, count: m.count }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return {
    photos: months.reduce((sum, m) => sum + m.count, 0),
    worlds: input.worlds,
    people: input.people,
    months,
  };
};

class InitStatsQueryError extends Error {
  override readonly name = 'InitStatsQueryError';
}

/**
 * 統計を集計して送る。集計の失敗は起動処理を止めない（統計は表示のためだけの値で、
 * 失敗しても写真の登録やログ同期の結果は変わらない）。失敗は Sentry へ送り、次の要求で再集計する。
 */
const collectAndEmitStats = (): Promise<void> => {
  if (!hasActiveInitProgressRun()) {
    return Promise.resolve();
  }
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const [months, worlds, people] = await Promise.all([
          getPhotoCountPerLocalMonth(),
          countDistinctVisitedWorlds(),
          countDistinctPlayerNames(),
        ]);
        return toInitStats({ months, worlds, people });
      },
      catch: (cause) =>
        new InitStatsQueryError('Failed to collect init progress stats', {
          cause,
        }),
    }).pipe(
      Effect.match({
        onSuccess: (stats) => {
          emitInitStats(stats);
        },
        onFailure: (error) => {
          logger.error({ message: error.message, stack: error });
        },
      }),
    ),
  );
};

const statsRunner = createThrottledRunner(collectAndEmitStats, INTERVAL_MS);

/**
 * 統計の更新を求める。DB に登録が入るたびに呼んでよい（送信は間引かれる）。
 */
export const requestInitStats = (): void => {
  statsRunner.request();
};

/**
 * 間引きを待たずに統計を集計して送り、完了を待つ。
 * 実行の区切り（DB 準備完了直後・実行終了直前）で最新の値を確実に届けるために使う。
 */
export const flushInitStats = (): Promise<void> => statsRunner.flush();
