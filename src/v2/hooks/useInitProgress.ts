import { useCallback, useEffect, useState } from 'react';
import { match } from 'ts-pattern';
import {
  type InitProgressPayload,
  type InitStage,
  parseInitProgressPayload,
  STAGE_LABELS,
} from '../lib/initProgress/schema';

// zodスキーマから型を再エクスポート
export type { InitProgressPayload, InitStage };
export { STAGE_LABELS };

/**
 * 初期化進捗を監視するフック
 * IPCから受け取ったデータをzodで検証して型安全に使用
 */
export const useInitProgress = () => {
  const [progress, setProgress] = useState<InitProgressPayload | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    // MyOn.receiveInitProgress が存在するかチェック
    if (typeof window.MyOn?.receiveInitProgress !== 'function') {
      return;
    }

    setIsListening(true);
    const cleanup = window.MyOn.receiveInitProgress((data: unknown) => {
      // zodで検証し、ts-patternで結果を処理
      const result = parseInitProgressPayload(data);
      match(result)
        .with({ success: true }, (r) => {
          setProgress(r.data);
          setValidationError(null);
        })
        .with({ success: false }, (r) => {
          // 検証失敗時はエラーをログに記録（開発時のデバッグ用）
          console.warn('Invalid progress payload received:', r.error.message);
          setValidationError(r.error.message);
        })
        .exhaustive();
    });

    return () => {
      setIsListening(false);
      cleanup?.();
    };
  }, []);

  const reset = useCallback(() => {
    setProgress(null);
    setValidationError(null);
  }, []);

  return {
    /** 検証済みの進捗情報 */
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
    /** IPC購読中かどうか */
    isListening,
    /** バリデーションエラー（開発時のデバッグ用） */
    validationError,
    /** 進捗情報をリセット */
    reset,
  };
};
