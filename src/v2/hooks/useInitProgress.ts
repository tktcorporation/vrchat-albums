import { useCallback, useState } from 'react';
import type {
  InitProgressPayload,
  InitStage,
} from '../../../electron/module/initProgress/types';
import { trpcReact } from '../../trpc';

// electronモジュールから型を再エクスポート
export type { InitProgressPayload, InitStage };

/**
 * ステージの日本語ラベル
 */
export const STAGE_LABELS: Record<InitStage, string> = {
  database_sync: 'データベース初期化',
  directory_check: 'ディレクトリ確認',
  log_append: 'ログファイル読み込み',
  log_load: 'ログデータ保存',
  photo_index: '写真インデックス',
  completed: '完了',
} as const;

/**
 * 初期化進捗を監視するフック
 * tRPC subscriptionを使用して型安全に進捗を受信
 */
export const useInitProgress = () => {
  const [progress, setProgress] = useState<InitProgressPayload | null>(null);

  // tRPC subscriptionで進捗を購読
  trpcReact.subscribeInitProgress.useSubscription(undefined, {
    onData: (data) => {
      setProgress(data);
    },
  });

  const reset = useCallback(() => {
    setProgress(null);
  }, []);

  return {
    /** 進捗情報 */
    progress,
    /** 現在のステージ */
    currentStage: progress?.stage ?? null,
    /** 進捗パーセント (0-100) */
    currentProgress: progress?.progress ?? 0,
    /** 進捗メッセージ */
    message: progress?.message ?? '',
    /** 詳細情報 */
    details: progress?.details,
    /** ステージの日本語ラベル */
    stageLabel: progress?.stage ? STAGE_LABELS[progress.stage] : '',
    /** 進捗情報をリセット */
    reset,
  };
};
