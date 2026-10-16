import type React from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';

import {
  type InitLaunch,
  type InitProgressDetails,
  type InitRunPayload,
  type InitStats,
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
  progress: InitRunPayload | null;
  /** 進捗パーセント (0-100)。同じ実行の中では減らない */
  progressPercent: number;
  /** 現在のステージの実件数 */
  progressDetails: InitProgressDetails | null;
  /** 同期モード。DB の準備前は null */
  syncMode: InitLaunch['syncMode'] | null;
  /** 初回起動か。DB の準備前は null */
  isFirstLaunch: boolean | null;
  /** 写真枚数・ワールド数・人数・月別枚数 */
  stats: InitStats | null;
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
  const {
    isSubscriptionReady,
    progress,
    overallProgress,
    details,
    syncMode,
    isFirstLaunch,
    stats,
    reset: resetProgress,
  } = useInitProgress();

  const { stages, errorMessage, originalError, retryProcess, completed } =
    useStartupStage({ isSubscriptionReady });

  // リトライ時に進捗状態もリセットする
  const handleRetry = useCallback(() => {
    resetProgress();
    retryProcess();
  }, [resetProgress, retryProcess]);

  // ステージマッピング
  const stage: Stage = (() => {
    if (stages.initialization === 'pending') {
      return 'idle';
    }
    if (stages.initialization === 'inProgress') {
      return 'syncing';
    }
    if (stages.initialization === 'success') {
      return 'ready';
    }
    if (stages.initialization === 'error') {
      return 'error';
    }
    return 'idle';
  })();

  // Context の value をメモ化して、不要な再レンダリングを防ぐ
  const value = useMemo<StartupContextValue>(
    () => ({
      stage,
      error: errorMessage || null,
      originalError,
      isReady: completed,
      retry: handleRetry,
      progress,
      progressPercent: overallProgress,
      progressDetails: details,
      syncMode,
      isFirstLaunch,
      stats,
    }),
    [
      stage,
      errorMessage,
      originalError,
      completed,
      handleRetry,
      progress,
      overallProgress,
      details,
      syncMode,
      isFirstLaunch,
      stats,
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
