import { useCallback, useEffect, useMemo, useState } from 'react';
import { match, P } from 'ts-pattern';
import { invalidatePhotoGalleryQueries } from '@/queryClient';
import { trpcReact } from '@/trpc';
import type { TypedTRPCError } from '../types/trpcErrors';

type ProcessStage = 'pending' | 'inProgress' | 'success' | 'error' | 'skipped';

export interface ProcessStages {
  /**
   * アプリケーション初期化処理の状態を追跡
   * - pending: 初期化待ち
   * - inProgress: 初期化実行中
   * - success: 初期化完了
   * - error: 初期化失敗
   */
  initialization: ProcessStage;
}

export interface ProcessError {
  stage: keyof ProcessStages;
  message: string;
  originalError?: unknown; // tRPCエラーオブジェクト全体を保持
}

interface ProcessStageCallbacks {
  onError?: (error: ProcessError) => void;
  onComplete?: () => void;
}

const initialStages: ProcessStages = {
  initialization: 'pending',
};

/**
 * アプリケーション起動時の初期化処理を管理するフック
 *
 * settingsController.initializeAppData を呼び出して、
 * データベース初期化、同期、ログ同期を順次実行します。
 */
export const useStartupStage = (callbacks?: ProcessStageCallbacks) => {
  const [stages, setStages] = useState<ProcessStages>(initialStages);
  const [error, setError] = useState<ProcessError | null>(null);
  const [hasNotifiedCompletion, setHasNotifiedCompletion] = useState(false);
  const [hasTriggeredInitialization, setHasTriggeredInitialization] =
    useState(false);

  // tRPC utils for query invalidation
  const utils = trpcReact.useUtils();

  // ステージ更新のヘルパー関数
  const updateStage = useCallback(
    (
      stage: keyof ProcessStages,
      status: ProcessStage,
      errorMsg?: string,
      originalError?: unknown,
    ) => {
      setStages((prev) => ({ ...prev, [stage]: status }));

      match(status)
        .when(
          (s) => s === 'error' && !!errorMsg,
          () => {
            const processError = {
              stage,
              message: errorMsg || '',
              originalError,
            };
            setError(processError);
            callbacks?.onError?.(processError);
          },
        )
        .with(P.union('success', 'skipped'), () => {
          setError(null);
        })
        .otherwise(() => {});
    },
    [callbacks],
  );

  // アプリケーション初期化ミューテーション
  const initializeAppDataMutation =
    trpcReact.settings.initializeAppData.useMutation({
      retry: false, // 重複実行を避けるため、リトライは無効
      onMutate: () => {
        updateStage('initialization', 'inProgress');
      },
      onSuccess: async () => {
        updateStage('initialization', 'success');

        // ログ同期完了後、ログ関連のクエリキャッシュを無効化
        try {
          invalidatePhotoGalleryQueries(utils);
        } catch (error) {
          console.warn('Failed to invalidate query cache:', error);
        }
      },
      onError: (error: TypedTRPCError | Error | unknown) => {
        // 重複実行エラーの場合は無視
        const shouldIgnore = match(error)
          .when(
            (e) =>
              e instanceof Error &&
              e.message.includes('初期化処理が既に実行中'),
            () => true,
          )
          .otherwise(() => false);

        if (shouldIgnore) return;

        const errorMessage = match(error)
          .with(P.instanceOf(Error), (e) => e.message)
          .otherwise(() => 'アプリケーション初期化に失敗しました');

        // tRPCエラーオブジェクト全体を保持
        updateStage('initialization', 'error', errorMessage, error);
      },
    });

  // 初期化処理を開始
  const startInitialization = useCallback(() => {
    match({
      stage: stages.initialization,
      isLoading: initializeAppDataMutation.isPending,
      isSuccess: initializeAppDataMutation.isSuccess,
      hasTriggered: hasTriggeredInitialization,
    })
      .with(
        {
          stage: 'pending',
          isLoading: false,
          isSuccess: false,
          hasTriggered: false,
        },
        () => {
          setHasTriggeredInitialization(true);
          initializeAppDataMutation.mutate();
        },
      )
      .otherwise(() => {});
  }, [
    stages.initialization,
    initializeAppDataMutation,
    hasTriggeredInitialization,
  ]);

  // 自動的に初期化を開始
  useEffect(() => {
    startInitialization();
  }, [startInitialization]);

  // リトライ処理
  const retryProcess = useCallback(() => {
    setStages(initialStages);
    setError(null);
    setHasNotifiedCompletion(false);
    setHasTriggeredInitialization(false);
    initializeAppDataMutation.reset();
    // startInitialization は useEffect で自動的に呼ばれる
  }, [initializeAppDataMutation]);

  // 完了判定
  const completed = useMemo(
    () => stages.initialization === 'success',
    [stages],
  );

  // 完了通知
  useEffect(() => {
    if (completed && !hasNotifiedCompletion) {
      setHasNotifiedCompletion(true);
      callbacks?.onComplete?.();
    }
  }, [completed, hasNotifiedCompletion, callbacks]);

  // 終了判定（成功またはエラー）
  const finished = useMemo(
    () =>
      match(stages.initialization)
        .with(P.union('success', 'error'), () => true)
        .otherwise(() => false),
    [stages],
  );

  return {
    stages,
    updateStage,
    errorMessage: error?.message ?? '',
    errorStage: error?.stage ?? '',
    originalError: error?.originalError,
    retryProcess,
    completed,
    finished,
  };
};
