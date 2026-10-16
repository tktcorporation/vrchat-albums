/**
 * 初期化進捗を tRPC subscription（`subscribeInitProgress`）へ送るエミッター。
 *
 * 進捗は「実行（run）」単位で送る。実行は起動時の初期化（`startup`）か、それ単独で呼ばれたログ同期
 * （`sync`）で、すべてのイベントに種類が入る。
 * 実行の状態をモジュールで 1 つだけ持ち、ステージの逆行と同一ステージ内の後退を
 * `advanceProgressCursor` で弾くことで、schema.ts に書いたストリームの不変条件を送信側で保証する。
 *
 * 呼び出し元は深い階層（ログ読み込み・写真インデックス）にあり、実行のハンドルを引数で
 * 引き回すと既存の関数シグネチャを広く変えることになるため、実行状態はモジュールに置く。
 * 実行の開始から終了までは、ログ同期のセマフォ（logSync/service.ts の syncMutex）の permit を
 * 持ったまま行う（起動時の初期化は初期化全体、単独のログ同期はその同期全体）。そのため実行が
 * 同時に 2 つ進むことは無い。開始時に返す runId を終了時に渡させ、開始した呼び出し元以外が
 * 実行を閉じられないようにしている。
 *
 * zod スキーマによる検証は subscription 側で行う。
 */
import { logger } from '../../lib/logger';
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

interface ActiveRun {
  readonly id: number;
  readonly kind: InitRunKind;
  launch: InitLaunch | null;
  cursor: ProgressCursor | null;
  /** 最後に送ったイベント（遅れて購読したクライアントへの再送用） */
  lastPayload: InitRunPayload | null;
  /** 最後に集計した統計（ステージ未送信の間に届いた統計もここに保持する） */
  latestStats: InitStats | undefined;
  /**
   * 現在のステージで最後に送った実件数。統計だけのイベントにも載せ、
   * 統計の更新で「3,412 / 8,900 枚」や処理中の月の表示が消えないようにする。ステージが変わったら捨てる
   */
  latestDetails: InitProgressDetails | undefined;
}

let lastRunId = 0;
let activeRun: ActiveRun | null = null;

const send = (payload: InitRunPayload): void => {
  if (activeRun) {
    activeRun.lastPayload = payload;
  }
  eventEmitter.emit(INIT_PROGRESS_CHANNEL, payload);
};

const toPayload = (
  run: ActiveRun,
  cursor: ProgressCursor,
  extra: Pick<InitRunPayload, 'details' | 'stats'>,
): InitRunPayload => ({
  runId: run.id,
  kind: run.kind,
  stage: PROGRESS_STAGES[cursor.stageIndex],
  progress: cursor.progress,
  launch: run.launch,
  ...extra,
});

/**
 * 新しい実行を始める。以後の進捗イベントはこの実行の ID で送られる。
 * ログ同期のセマフォの permit を持った状態で呼ぶ（ファイル冒頭の説明を参照）。
 *
 * @param kind 起動時の初期化なら `startup`、単独のログ同期なら `sync`
 * @param launch 起動種別。DB の準備前で判定できないときは null を渡し、
 *               判定後に setInitProgressLaunch で設定する
 * @returns この実行の ID。endInitProgressRun に渡す
 */
export const beginInitProgressRun = (
  kind: InitRunKind,
  launch: InitLaunch | null,
): number => {
  if (activeRun) {
    logger.warn(
      `Init progress run ${activeRun.id} was replaced before it finished`,
    );
  }
  lastRunId += 1;
  activeRun = {
    id: lastRunId,
    kind,
    launch,
    cursor: null,
    lastPayload: null,
    latestStats: undefined,
    latestDetails: undefined,
  };
  return lastRunId;
};

/**
 * 進行中の実行の ID と種類。実行が無ければ null。
 * 統計の集計（stats.ts）が、起動時の初期化の間だけ DB を数え、集計の失敗を実行ごとに 1 回だけ
 * 報告するために使う。
 */
export const getActiveInitProgressRun = (): {
  readonly id: number;
  readonly kind: InitRunKind;
} | null => (activeRun ? { id: activeRun.id, kind: activeRun.kind } : null);

/**
 * 進行中の実行の起動種別を設定する。以後のすべてのイベントに入る。
 */
export const setInitProgressLaunch = (launch: InitLaunch): void => {
  if (activeRun) {
    activeRun.launch = launch;
  }
};

/**
 * ステージの進捗を送る。進行中の実行が無いとき、または既に先のステージへ進んでいるときは送らない。
 * 同じステージで前回より小さい progress が渡された場合は前回値で送る。
 * 同じステージで details を省いた場合は、そのステージで最後に送った details を載せる。
 *
 * @param progress ステージ内の進捗（0-100）
 * @param details 実件数。件数を数えられるステージでのみ渡す
 */
export const emitStageProgress = (
  stage: ProgressStage,
  progress: number,
  details?: InitProgressDetails,
): void => {
  const run = activeRun;
  if (!run) {
    return;
  }
  const decision = advanceProgressCursor(run.cursor, stage, progress);
  if (decision.kind === 'reject_backward') {
    logger.warn(
      `Init progress stage "${stage}" was emitted after "${PROGRESS_STAGES[decision.cursor.stageIndex]}" and was dropped`,
    );
    return;
  }
  const sameStage = run.cursor?.stageIndex === decision.cursor.stageIndex;
  run.latestDetails = sameStage ? (details ?? run.latestDetails) : details;
  run.cursor = decision.cursor;
  send(toPayload(run, decision.cursor, { details: run.latestDetails }));
};

/**
 * 統計を送る。最後に送った進捗と同じステージ・進捗・実件数のイベントに載せる。
 * まだどのステージも送っていなければ保持だけして、次の進捗イベントに載せる。
 * 統計は起動画面のためだけの値なので、`startup` 以外の実行では捨てる。
 *
 * 間引きは呼び出し側（stats.ts）が行う。
 *
 * @param runId 集計を始めたときの実行の ID
 * @param stats 集計した統計
 */
export const emitInitStats = (runId: number, stats: InitStats): void => {
  const run = activeRun;
  // 集計は非同期なので、集計中に実行が入れ替わる（失敗した初期化の直後に再試行する等）ことがある。
  // 集計を始めた実行でなければ、別の実行の値を混ぜないよう捨てる。
  if (run?.kind !== 'startup' || run.id !== runId) {
    return;
  }
  run.latestStats = stats;
  if (run.cursor === null) {
    return;
  }
  send(toPayload(run, run.cursor, { details: run.latestDetails, stats }));
};

/**
 * 実行を終える。終端イベント（`completed` / `error`）を送り、実行状態を破棄する。
 * 渡された runId が進行中の実行と一致しなければ何もしない（別の呼び出し元の実行を閉じない）。
 *
 * @param runId beginInitProgressRun が返した ID
 */
export const endInitProgressRun = (
  runId: number,
  outcome: 'completed' | 'error',
): void => {
  const run = activeRun;
  if (!run) {
    return;
  }
  if (run.id !== runId) {
    logger.warn(
      `Init progress run ${runId} tried to end run ${run.id} and was ignored`,
    );
    return;
  }
  const payload: InitRunPayload = {
    runId: run.id,
    kind: run.kind,
    stage: outcome,
    progress: outcome === 'completed' ? 100 : (run.cursor?.progress ?? 0),
    launch: run.launch,
  };
  send(payload);
  activeRun = null;
};

/**
 * 進行中の実行の最新状態。subscription に遅れて接続したクライアントへ、
 * 次のイベントを待たずに現在地と統計を渡すために使う。進行中の実行が無ければ null。
 */
export const getInitProgressReplay = (): InitRunPayload | null => {
  const run = activeRun;
  if (!run?.lastPayload) {
    return null;
  }
  return {
    ...run.lastPayload,
    launch: run.launch,
    stats: run.latestStats,
  };
};
