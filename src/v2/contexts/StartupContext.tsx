import type React from 'react';
import { createContext, useContext, useMemo } from 'react';
import {
  type InitProgressPayload,
  useInitProgress,
} from '../hooks/useInitProgress';
import { useStartupStage } from '../hooks/useStartUpStage';

type Stage = 'idle' | 'syncing' | 'ready' | 'error';

interface StartupContextValue {
  stage: Stage;
  error: string | null;
  originalError?: unknown; // tRPCエラーオブジェクト全体
  isReady: boolean;
  retry: () => void;
  /** 初期化進捗情報 */
  progress: InitProgressPayload | null;
  /** 進捗メッセージ */
  progressMessage: string;
  /** 進捗パーセント (0-100) */
  progressPercent: number;
}

const StartupContext = createContext<StartupContextValue | null>(null);

interface StartupProviderProps {
  children: React.ReactNode;
}

/**
 * アプリケーション起動処理を管理するContext Provider
 * useStartupStageフックを使用してスタートアップ処理を実行します。
 */
export const StartupProvider: React.FC<StartupProviderProps> = ({
  children,
}) => {
  const { stages, errorMessage, originalError, retryProcess, completed } =
    useStartupStage();
  const { progress, message, currentProgress } = useInitProgress();

  // ステージマッピング
  const stage: Stage = (() => {
    if (stages.initialization === 'pending') return 'idle';
    if (stages.initialization === 'inProgress') return 'syncing';
    if (stages.initialization === 'success') return 'ready';
    if (stages.initialization === 'error') return 'error';
    return 'idle';
  })();

  // Context の value をメモ化して、不要な再レンダリングを防ぐ
  const value = useMemo<StartupContextValue>(
    () => ({
      stage,
      error: errorMessage || null,
      originalError,
      isReady: completed,
      retry: retryProcess,
      progress,
      progressMessage: message,
      progressPercent: currentProgress,
    }),
    [
      stage,
      errorMessage,
      originalError,
      completed,
      retryProcess,
      progress,
      message,
      currentProgress,
    ],
  );

  return (
    <StartupContext.Provider value={value}>{children}</StartupContext.Provider>
  );
};

/**
 * 起動状態を取得するフック
 */
export const useStartup = (): StartupContextValue => {
  const context = useContext(StartupContext);
  if (!context) {
    throw new Error('useStartup must be used within a StartupProvider');
  }
  return context;
};
