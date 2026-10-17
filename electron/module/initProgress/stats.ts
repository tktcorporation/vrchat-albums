/**
 * 起動画面の統計（写真枚数・ワールド数・人数・月別枚数）を DB から集計するコレクター。
 *
 * コレクターは起動時の初期化の実行（emitter.ts の `beginInitProgressRun`）ごとに 1 つ作られ、その実行が
 * 持つ。間引きのタイマー・数えたワールド数と人数・失敗を報告したかどうかはコレクターの中にあり、
 * 実行が終わるとコレクターも閉じて、予約していた集計を走らせない。
 *
 * 月別の写真枚数は毎回 DB から数え直す。インデックス中の写真を手元で足し込む方式だと、
 * 全件再スキャンで既存の写真を上書きしたときに二重に数えてしまうため。
 * ワールド数・人数はログの登録でしか変わらないので、数えた値を保持して必要なときだけ数え直す。
 * 写真のバッチ登録ごとに集計を求められるので、前回の集計が終わってから INTERVAL_MS 空けるまで
 * 次の集計を始めない。
 *
 * 単独のログ同期（`sync` の実行）はコレクターを持たない。統計を表示するのは起動画面だけで、
 * 起動後の同期（手動更新・バックグラウンド同期など）で写真テーブル全体を 1 秒に何度も GROUP BY すると、
 * その同期の写真登録と SQLite を取り合うため。
 */
import { Effect } from 'effect';

import { logger } from '../../lib/logger';
import { getPhotoCountPerLocalMonth } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import { countDistinctPlayerNames } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { countDistinctVisitedWorlds } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import type { InitStats } from './schema';

/**
 * 集計が終わってから次の集計を始めるまでに空ける時間。1 秒あたり 10 回を超えて集計・送信しない。
 * 集計の開始からではなく終了から数えるのは、写真の登録中に集計が遅くなったとき、
 * 集計クエリが間を空けずに続いて SQLite を登録処理と取り合わないようにするため。
 */
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
 * 非同期タスクを、前回の実行が終わってから intervalMs 以上空けて実行するランナー。
 *
 * - request: 前回の終了から intervalMs 経っていればすぐ実行し、経っていなければその時点で 1 回だけ実行する。
 *   実行中に要求されたら、終わってから intervalMs 後にもう 1 回実行する（最後の要求の結果が必ず反映される）
 * - flush: 予約を取り消し、実行中のものを待ってから、間隔に関係なく 1 回実行して完了を待つ
 * - close: 予約を取り消し、以後の request を何もしないものにする
 *
 * @param task 失敗しても reject しないこと（失敗の扱いはタスク側の責務）
 */
export const createThrottledRunner = (
  task: () => Promise<void>,
  intervalMs: number,
  timers: ThrottleTimers = realTimers,
) => {
  let lastFinishedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let timer: unknown = null;
  let pendingAfterRun = false;
  let closed = false;

  const cancelScheduled = (): void => {
    if (timer !== null) {
      timers.clearTimer(timer);
      timer = null;
    }
    pendingAfterRun = false;
  };

  const run = (): Promise<void> => {
    const current = task().finally(() => {
      inFlight = null;
      lastFinishedAt = timers.now();
      if (pendingAfterRun) {
        pendingAfterRun = false;
        request();
      }
    });
    inFlight = current;
    return current;
  };

  const request = (): void => {
    if (closed) {
      return;
    }
    if (inFlight) {
      pendingAfterRun = true;
      return;
    }
    if (timer !== null) {
      return;
    }
    const wait = lastFinishedAt + intervalMs - timers.now();
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
    cancelScheduled();
    if (inFlight) {
      await inFlight;
      // 待っている間に来た要求は、これから行う実行で満たされる
      cancelScheduled();
    }
    await run();
  };

  const close = (): void => {
    closed = true;
    cancelScheduled();
  };

  return { request, flush, close };
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

/** 1 回の実行が持つ統計のコレクター */
export interface InitStatsCollector {
  /**
   * 統計の更新を求める。DB に登録が入るたびに呼んでよい（集計は間引かれる）。
   * ログ（ワールド・プレイヤーの記録）を登録した後は `logsChanged: true` を渡し、ワールド数・人数を数え直させる。
   */
  readonly request: (options: { readonly logsChanged: boolean }) => void;
  /**
   * 間引きを待たずにワールド数・人数も含めて数え直し、完了を待つ。
   * 実行の区切り（DB 準備完了直後・実行終了直前）で最新の値を確実に届けるために使う。
   */
  readonly flush: () => Promise<void>;
  /** 予約していた集計を取り消し、以後の request を何もしないものにする */
  readonly close: () => void;
}

/**
 * 統計のコレクターを作る。
 *
 * 集計の失敗は起動処理を止めない（統計は表示のためだけの値で、失敗しても写真の登録やログ同期の
 * 結果は変わらない）。失敗はコレクターごとに 1 回だけ error で報告し、2 回目以降は warn に留める。
 * 集計は 1 秒に最大 10 回求められるので、DB が読めない状態が続くと同じ原因のエラーが
 * Sentry へ大量に届くため。失敗しても次の要求で集計し直す。
 *
 * @param deliver 集計した統計の届け先
 */
export const createInitStatsCollector = (
  deliver: (stats: InitStats) => void,
  timers: ThrottleTimers = realTimers,
): InitStatsCollector => {
  let failureReported = false;
  /**
   * 数えたワールド数・人数。ログの登録でしか変わらないので、写真の登録中の集計では使い回し、
   * ログの登録後と flush で捨てて数え直す。数え直しに失敗した間は null のままなので、次の集計で再び数える
   */
  let logCounts: { readonly worlds: number; readonly people: number } | null =
    null;

  const reportFailure = (error: InitStatsQueryError): void => {
    if (failureReported) {
      logger.warn(`${error.message} (repeated in the same run)`);
      return;
    }
    failureReported = true;
    logger.error({ message: error.message, stack: error });
  };

  const collect = (): Promise<void> => {
    const cached = logCounts;
    return Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          const [months, counts] = await Promise.all([
            getPhotoCountPerLocalMonth(),
            cached ??
              Promise.all([
                countDistinctVisitedWorlds(),
                countDistinctPlayerNames(),
              ]).then(([worlds, people]) => ({ worlds, people })),
          ]);
          logCounts = counts;
          return toInitStats({
            months,
            worlds: counts.worlds,
            people: counts.people,
          });
        },
        catch: (cause) =>
          new InitStatsQueryError('Failed to collect init progress stats', {
            cause,
          }),
      }).pipe(
        Effect.match({
          onSuccess: deliver,
          onFailure: reportFailure,
        }),
      ),
    );
  };

  const runner = createThrottledRunner(collect, INTERVAL_MS, timers);

  return {
    request: ({ logsChanged }) => {
      if (logsChanged) {
        logCounts = null;
      }
      runner.request();
    },
    flush: () => {
      logCounts = null;
      return runner.flush();
    },
    close: runner.close,
  };
};
