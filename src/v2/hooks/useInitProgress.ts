import { useCallback, useMemo, useState } from 'react';
import {
  type InitProgressPayload,
  type InitStage,
  STAGE_LABELS,
} from '../../../electron/module/initProgress/schema';
import { trpcReact } from '../../trpc';

// electronモジュールから型とラベルを再エクスポート
export type { InitProgressPayload, InitStage };
export { STAGE_LABELS };

/**
 * ステージごとの重み付け（合計100）
 */
const STAGE_WEIGHTS: Partial<Record<InitStage, number>> = {
  database_sync: 20,
  directory_check: 15,
  log_append: 15,
  log_load: 25,
  photo_index: 25,
};

/**
 * 処理順序で並べたステージ一覧
 */
const ORDERED_STAGES: InitStage[] = [
  'database_sync',
  'directory_check',
  'log_append',
  'log_load',
  'photo_index',
];

/**
 * 全体進捗を計算する
 * @param stage 現在のステージ
 * @param stageProgress ステージ内進捗 (0-100)
 */
const calculateOverallProgress = (
  stage: InitStage,
  stageProgress: number,
): number => {
  if (stage === 'completed') return 100;
  if (stage === 'error' || stage === 'ready') return 0;

  const idx = ORDERED_STAGES.indexOf(stage);
  if (idx === -1) return 0;

  // 前ステージまでの累積
  const prevTotal = ORDERED_STAGES.slice(0, idx).reduce(
    (sum, s) => sum + (STAGE_WEIGHTS[s] ?? 0),
    0,
  );

  // 現在ステージの進捗を加算
  const currentWeight = STAGE_WEIGHTS[stage] ?? 0;
  return Math.round(prevTotal + (stageProgress / 100) * currentWeight);
};

/**
 * 初期化進捗を監視するフック
 * tRPC subscriptionを使用して型安全に進捗を受信
 */
export const useInitProgress = () => {
  const [progress, setProgress] = useState<InitProgressPayload | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isSubscriptionReady, setIsSubscriptionReady] = useState(false);

  // tRPC subscriptionで進捗を購読
  trpcReact.subscribeInitProgress.useSubscription(undefined, {
    onData: (data) => {
      // readyイベントはsubscription接続完了の通知として扱う
      if (data.stage === 'ready') {
        setIsSubscriptionReady(true);
        return; // readyイベントはprogressとして設定しない
      }
      setProgress(data);
      setError(null);
    },
    onError: (err) => {
      console.error('Init progress subscription error:', err);
      // 元のエラー情報を cause で保持（スタックトレース消失を防ぐ）
      setError(new Error(err.message, { cause: err }));
    },
  });

  const reset = useCallback(() => {
    setProgress(null);
    setError(null);
    setIsSubscriptionReady(false);
  }, []);

  /**
   * 全体進捗を計算
   * ステージベースの進捗 + ステージ内進捗を組み合わせて計算
   */
  const overallProgress = useMemo(() => {
    if (!progress?.stage) return 0;
    return calculateOverallProgress(progress.stage, progress.progress ?? 0);
  }, [progress?.stage, progress?.progress]);

  return {
    /** subscription接続完了フラグ */
    isSubscriptionReady,
    /** 進捗情報 */
    progress,
    /** 現在のステージ */
    currentStage: progress?.stage ?? null,
    /** ステージ内進捗パーセント (0-100) */
    currentProgress: progress?.progress ?? 0,
    /** 全体進捗パーセント (0-100) - ステージベース計算 */
    overallProgress,
    /** 進捗メッセージ */
    message: progress?.message ?? '',
    /** 詳細情報 */
    details: progress?.details,
    /** ステージの日本語ラベル */
    stageLabel: progress?.stage ? STAGE_LABELS[progress.stage] : '',
    /** subscription エラー */
    error,
    /** 進捗情報をリセット */
    reset,
  };
};
