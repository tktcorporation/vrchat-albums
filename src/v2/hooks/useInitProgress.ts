import { useCallback, useMemo, useState } from 'react';
import type {
  InitProgressPayload,
  InitStage,
} from '../../../electron/module/initProgress/types';
import { STAGE_LABELS } from '../../../electron/module/initProgress/types';
import { trpcReact } from '../../trpc';

// electronモジュールから型とラベルを再エクスポート
export type { InitProgressPayload, InitStage };
export { STAGE_LABELS };

/**
 * ステージごとの進捗設定
 * - base: ステージ開始時点での全体進捗パーセント
 * - range: 次のステージまでの進捗幅
 */
const STAGE_PROGRESS_CONFIG: Record<
  InitStage,
  { base: number; range: number }
> = {
  ready: { base: 0, range: 0 },
  database_sync: { base: 0, range: 20 }, // 0% → 20%
  directory_check: { base: 20, range: 15 }, // 20% → 35%
  log_append: { base: 35, range: 15 }, // 35% → 50%
  log_load: { base: 50, range: 25 }, // 50% → 75%
  photo_index: { base: 75, range: 25 }, // 75% → 100%
  completed: { base: 100, range: 0 },
  error: { base: 0, range: 0 }, // エラー時は進捗を維持しない
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

    const config = STAGE_PROGRESS_CONFIG[progress.stage];
    const stageProgress = progress.progress ?? 0;

    // ステージ内の進捗を全体進捗に変換
    // base + (stageProgress / 100) * range
    return Math.round(config.base + (stageProgress / 100) * config.range);
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
