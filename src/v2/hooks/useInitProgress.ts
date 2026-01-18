import { useCallback, useEffect, useState } from 'react';

/**
 * 初期化処理のステージ
 * electron/module/initProgress/types.ts と同期
 */
export type InitStage =
  | 'database_sync'
  | 'directory_check'
  | 'log_append'
  | 'log_load'
  | 'photo_index'
  | 'completed';

/**
 * 初期化進捗イベントのペイロード
 */
export interface InitProgressPayload {
  stage: InitStage;
  progress: number;
  message: string;
  details?: {
    current?: number;
    total?: number;
    currentItem?: string;
  };
}

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
};

/**
 * 初期化進捗を監視するフック
 */
export const useInitProgress = () => {
  const [progress, setProgress] = useState<InitProgressPayload | null>(null);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    // MyOn.receiveInitProgress が存在するかチェック
    if (typeof window.MyOn?.receiveInitProgress !== 'function') {
      return;
    }

    setIsListening(true);
    const cleanup = window.MyOn.receiveInitProgress((data) => {
      setProgress(data);
    });

    return () => {
      setIsListening(false);
      cleanup?.();
    };
  }, []);

  const reset = useCallback(() => {
    setProgress(null);
  }, []);

  return {
    progress,
    currentStage: progress?.stage ?? null,
    currentProgress: progress?.progress ?? 0,
    message: progress?.message ?? '',
    details: progress?.details,
    stageLabel: progress?.stage ? STAGE_LABELS[progress.stage] : '',
    isListening,
    reset,
  };
};
