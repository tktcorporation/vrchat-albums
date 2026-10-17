import { logger } from '../../lib/logger';
/**
 * 初期化進捗を tRPC subscription（`subscribeInitProgress`）へ送る実行（run）のハンドル。
 *
 * 進捗は実行単位で送る。実行は起動時の初期化（`startup`）か、それ単独で呼ばれたログ同期（`sync`）で、
 * `beginInitProgressRun` が返すハンドルがその実行の状態と操作をすべて持つ。進捗を送る処理には
 * ハンドルを引数で渡し、モジュールの「現在の実行」を引いて送ることはしない。
 * ハンドルは `end` で閉じ、閉じた後の操作は何もしない。統計の集計（`startup` だけが持つ）の結果も
 * 集計を始めたハンドルにしか届かないので、終わった実行の結果が次の実行へ混ざることは無い。
 *
 * ステージの逆行と同一ステージ内の後退は `advanceProgressCursor` で弾き、schema.ts に書いたストリームの
 * 不変条件を送信側で保証する。zod スキーマによる検証は subscription 側で行う。
 */
import { eventEmitter } from '../../trpc';
import { advanceProgressCursor, type ProgressCursor } from './progressCursor';
import {
  INIT_PROGRESS_CHANNEL,
  type InitLaunch,
  type InitProgressDetails,
  type InitRunKind,
  type InitRunPayload,
  type InitStats,
  PROGRESS_STAGES,
  type ProgressStage,
} from './schema';
import { createInitStatsCollector } from './stats';

/** 1 回の実行のハンドル */
export interface InitProgressRun {
  /** ペイロードの runId */
  readonly runId: number;
  readonly kind: InitRunKind;
  /**
   * ステージの進捗を送る。既に先のステージへ進んでいるときは送らない。
   * 同じステージで前回より小さい progress が渡された場合は前回値で送る。
   * 同じステージで details を省いた場合は、そのステージで最後に送った details を載せる。
   *
   * @param progress ステージ内の進捗（0-100）
   * @param details 実件数。件数を数えられるステージでのみ渡す
   */
  readonly stage: (
    stage: ProgressStage,
    progress: number,
    details?: InitProgressDetails,
  ) => void;
  /** 起動種別を設定する。以後のすべてのイベントに入る */
  readonly setLaunch: (launch: InitLaunch) => void;
  /**
   * DB に登録が入ったことを知らせ、統計を集計し直させる（間引かれる）。
   * ログ（ワールド・プレイヤーの記録）を登録した後は `logsChanged: true` を渡す。
   * `sync` の実行は統計を持たないので何もしない。
   */
  readonly dbUpdated: (change: { readonly logsChanged: boolean }) => void;
  /**
   * 間引きを待たずに統計を集計して送り、完了を待つ。実行の区切り（DB 準備完了直後・
   * `end('completed')` の直前）で最新の値を確実に届けるために使う。`sync` の実行では何もしない。
   */
  readonly flushStats: () => Promise<void>;
  /** 終端イベント（`completed` / `error`）を送って実行を閉じる。以後の操作は何もしない */
  readonly end: (outcome: 'completed' | 'error') => void;
}

let lastRunId = 0;
/** 開いている実行の最新状態。subscription へ遅れて接続したクライアントへの再送にだけ使う */
let replaySource: (() => InitRunPayload | null) | null = null;

/**
 * 新しい実行を始める。ログ同期のセマフォ（logSync/service.ts の syncMutex）の permit を持った状態で呼び、
 * 同じ permit の内側で `end` する。そのため実行が同時に 2 つ開くことは無い。
 *
 * 統計は起動画面だけが表示する値なので、`startup` の実行だけが集計する。起動後の単独の同期で写真テーブル
 * 全体を何度も数えると、その同期の写真登録と SQLite を取り合うため。
 *
 * @param kind 起動時の初期化なら `startup`、単独のログ同期なら `sync`
 * @param launch 起動種別。DB の準備前で判定できないときは null を渡し、判定後に setLaunch で設定する
 */
export const beginInitProgressRun = (
  kind: InitRunKind,
  launch: InitLaunch | null,
): InitProgressRun => {
  lastRunId += 1;
  const runId = lastRunId;
  let currentLaunch = launch;
  let cursor: ProgressCursor | null = null;
  /** 現在のステージで最後に送った実件数。統計だけのイベントにも載せ、表示が消えないようにする */
  let details: InitProgressDetails | undefined;
  let stats: InitStats | undefined;
  let lastPayload: InitRunPayload | null = null;
  let closed = false;

  const send = (payload: InitRunPayload): void => {
    lastPayload = payload;
    eventEmitter.emit(INIT_PROGRESS_CHANNEL, payload);
  };

  const toPayload = (at: ProgressCursor, withStats?: InitStats) => ({
    runId,
    kind,
    stage: PROGRESS_STAGES[at.stageIndex],
    progress: at.progress,
    launch: currentLaunch,
    details,
    stats: withStats,
  });

  const collector =
    kind === 'startup'
      ? createInitStatsCollector((collected) => {
          if (closed) {
            return;
          }
          stats = collected;
          // まだどのステージも送っていなければ保持だけして、再送に載せる
          if (cursor !== null) {
            send(toPayload(cursor, collected));
          }
        })
      : null;

  const replay = (): InitRunPayload | null =>
    lastPayload === null
      ? null
      : { ...lastPayload, launch: currentLaunch, stats };
  replaySource = replay;

  return {
    runId,
    kind,
    stage: (stage, progress, stageDetails) => {
      if (closed) {
        return;
      }
      const decision = advanceProgressCursor(cursor, stage, progress);
      if (decision.kind === 'reject_backward') {
        logger.warn(
          `Init progress stage "${stage}" was emitted after "${PROGRESS_STAGES[decision.cursor.stageIndex]}" and was dropped`,
        );
        return;
      }
      const sameStage = cursor?.stageIndex === decision.cursor.stageIndex;
      details = sameStage ? (stageDetails ?? details) : stageDetails;
      cursor = decision.cursor;
      send(toPayload(cursor));
    },
    setLaunch: (next) => {
      if (!closed) {
        currentLaunch = next;
      }
    },
    dbUpdated: (change) => {
      if (!closed) {
        collector?.request(change);
      }
    },
    flushStats: () =>
      closed || collector === null ? Promise.resolve() : collector.flush(),
    end: (outcome) => {
      if (closed) {
        return;
      }
      send({
        runId,
        kind,
        stage: outcome,
        progress: outcome === 'completed' ? 100 : (cursor?.progress ?? 0),
        launch: currentLaunch,
      });
      closed = true;
      collector?.close();
      if (replaySource === replay) {
        replaySource = null;
      }
    },
  };
};

/**
 * 開いている実行の最新状態。subscription に遅れて接続したクライアントへ、
 * 次のイベントを待たずに現在地と統計を渡すために使う。開いている実行が無いか、まだ何も送っていなければ null。
 */
export const getInitProgressReplay = (): InitRunPayload | null =>
  replaySource?.() ?? null;
