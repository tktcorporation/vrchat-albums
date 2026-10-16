import { useCallback, useState } from 'react';
import { match } from 'ts-pattern';

import type {
  InitLaunch,
  InitProgressDetails,
  InitRunKind,
  InitRunPayload,
  InitStats,
  ProgressStage,
  RunStage,
} from '../../../electron/module/initProgress/schema';
import { trpcReact } from '../../trpc';

export type { InitLaunch, InitProgressDetails, InitRunPayload, InitStats };

/**
 * 全体進捗に占める各ステージの重み（合計 100）。
 * 初回起動で最も時間がかかる写真インデックス（画像の読み込みと DB 登録）に最も大きく割り当てる。
 */
const STAGE_WEIGHTS = {
  database_sync: 10,
  log_append: 15,
  log_load: 25,
  photo_index: 35,
  photo_metadata: 10,
  photo_log_import: 5,
} as const satisfies Record<ProgressStage, number>;

const STAGE_ORDER = Object.keys(STAGE_WEIGHTS) as ProgressStage[];

/**
 * 1 つのイベントが示す全体進捗（0-100）。終端の `error` は全体の位置を持たないため null。
 * 処理対象が無く送られなかったステージは、後ろのステージが届いた時点で完了扱いになる。
 */
const overallFromEvent = (stage: RunStage, progress: number): number | null =>
  match(stage)
    .with('completed', () => 100)
    .with('error', () => null)
    .otherwise((progressStage) => {
      const index = STAGE_ORDER.indexOf(progressStage);
      const before = STAGE_ORDER.slice(0, index).reduce(
        (sum, s) => sum + STAGE_WEIGHTS[s],
        0,
      );
      return Math.round(
        before + (progress / 100) * STAGE_WEIGHTS[progressStage],
      );
    });

/**
 * 画面に出した全体進捗。実行（runId）ごとに 0 から始まる。
 */
export interface ShownOverallProgress {
  readonly runId: number;
  readonly percent: number;
}

/**
 * 次に表示する全体進捗を決める。同じ実行の中では前回表示した値より小さくしない。
 * 実行が変わったら（手動更新やリトライで新しい実行が始まったら）その実行の値から数え直す。
 */
export const nextShownOverallProgress = (
  shown: ShownOverallProgress | null,
  event: Pick<InitRunPayload, 'runId' | 'stage' | 'progress'>,
): ShownOverallProgress => {
  const sameRun = shown !== null && shown.runId === event.runId;
  const floor = sameRun ? shown.percent : 0;
  const percent = overallFromEvent(event.stage, event.progress) ?? floor;
  return { runId: event.runId, percent: Math.max(floor, percent) };
};

/**
 * 初期化進捗の受信状態。統計と起動種別は、届かないイベントがあっても最後に届いた値を保持する。
 * 実件数は同じ実行・同じステージの間だけ保持する。
 */
interface InitProgressState {
  /** 最後に届いたイベント */
  latest: InitRunPayload | null;
  shown: ShownOverallProgress | null;
  launch: InitLaunch | null;
  stats: InitStats | null;
  details: InitProgressDetails | null;
}

export const initialInitProgressState: InitProgressState = {
  latest: null,
  shown: null,
  launch: null,
  stats: null,
  details: null,
};

/**
 * 受信したイベントを状態に反映する。新しい実行のイベントが来たら、前の実行の統計や起動種別は捨てる。
 * details を持たないイベントが同じ実行・同じステージで届いた場合は、直前の実件数を残す
 * （統計だけのイベントで件数表示や処理中の月の強調が消えないようにする）。
 */
export const reduceInitProgress = (
  state: InitProgressState,
  event: InitRunPayload,
): InitProgressState => {
  const sameRun = state.latest?.runId === event.runId;
  const sameStage = sameRun && state.latest?.stage === event.stage;
  return {
    latest: event,
    shown: nextShownOverallProgress(state.shown, event),
    launch: event.launch ?? (sameRun ? state.launch : null),
    stats: event.stats ?? (sameRun ? state.stats : null),
    details: event.details ?? (sameStage ? state.details : null),
  };
};

/**
 * イベントを状態に反映する。`runKind` を指定したときは、その種類の実行のイベントだけを反映し、
 * それ以外は状態をそのまま返す（同じ参照を返すので React は再描画しない）。
 *
 * 起動画面は `startup` だけを見る。起動画面の表示中に単独のログ同期がロックを持っていると、
 * subscription の接続時にその同期の現在地が再送されるが、それで起動画面の進捗や
 * 「準備ができました」を動かさないため。起動後の同期で起動画面の状態が更新され続けることも防ぐ。
 */
export const applyInitProgressEvent = (
  state: InitProgressState,
  event: InitRunPayload,
  runKind: InitRunKind | undefined,
): InitProgressState =>
  runKind !== undefined && event.kind !== runKind
    ? state
    : reduceInitProgress(state, event);

interface UseInitProgressOptions {
  /** 指定した種類の実行のイベントだけを受け取る。省略時はすべての実行を受け取る */
  runKind?: InitRunKind;
}

/**
 * 初期化進捗を監視するフック
 * tRPC subscriptionを使用して型安全に進捗を受信
 */
export const useInitProgress = ({ runKind }: UseInitProgressOptions = {}) => {
  const [state, setState] = useState<InitProgressState>(
    initialInitProgressState,
  );
  const [error, setError] = useState<Error | null>(null);
  const [isSubscriptionReady, setIsSubscriptionReady] = useState(false);

  // tRPC subscriptionで進捗を購読
  trpcReact.subscribeInitProgress.useSubscription(undefined, {
    onData: (data) => {
      // readyイベントはsubscription接続完了の通知として扱う
      if (data.stage === 'ready') {
        setIsSubscriptionReady(true);
        return;
      }
      setState((prev) => applyInitProgressEvent(prev, data, runKind));
      setError(null);
    },
    onError: (err) => {
      console.error('Init progress subscription error:', err);
      // 元のエラー情報を cause で保持（スタックトレース消失を防ぐ）
      setError(new Error(err.message, { cause: err }));
    },
  });

  const reset = useCallback(() => {
    setState(initialInitProgressState);
    setError(null);
    setIsSubscriptionReady(false);
  }, []);

  return {
    /** subscription接続完了フラグ */
    isSubscriptionReady,
    /** 最後に届いた進捗イベント（stage, progress, details など） */
    progress: state.latest,
    /** 現在のステージ。まだ何も届いていなければ null */
    stage: state.latest?.stage ?? null,
    /** 全体進捗パーセント (0-100)。同じ実行の中では減らない */
    overallProgress: state.shown?.percent ?? 0,
    /** 現在のステージの実件数 */
    details: state.details,
    /** 同期モード。DB の準備前は null */
    syncMode: state.launch?.syncMode ?? null,
    /** 初回起動か。DB の準備前は null */
    isFirstLaunch: state.launch?.isFirstLaunch ?? null,
    /** 最後に届いた統計（写真枚数・ワールド数・人数・月別枚数） */
    stats: state.stats,
    /** subscription エラー */
    error,
    /** 進捗情報をリセット */
    reset,
  };
};
