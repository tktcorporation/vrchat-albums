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
 * ステージ設定（順序と重み付けを統合）
 * 順序はこの配列の順序に従う。重みの合計は100。
 */
const STAGE_CONFIG: ReadonlyArray<{ stage: InitStage; weight: number }> = [
  { stage: 'database_sync', weight: 20 },
  { stage: 'directory_check', weight: 15 },
  { stage: 'log_append', weight: 15 },
  { stage: 'log_load', weight: 25 },
  { stage: 'photo_index', weight: 25 },
] as const;

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

  const idx = STAGE_CONFIG.findIndex((c) => c.stage === stage);
  if (idx === -1) return 0;

  // 前ステージまでの累積
  const prevTotal = STAGE_CONFIG.slice(0, idx).reduce(
    (sum, c) => sum + c.weight,
    0,
  );

  // 現在ステージの進捗を加算
  const currentWeight = STAGE_CONFIG[idx].weight;
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
    /** 進捗情報（stage, progress, message, details を含む） */
    progress,
    /** 全体進捗パーセント (0-100) - ステージベース計算 */
    overallProgress,
    /** 進捗メッセージ */
    message: progress?.message ?? '',
    /** subscription エラー */
    error,
    /** 進捗情報をリセット */
    reset,
  };
};
