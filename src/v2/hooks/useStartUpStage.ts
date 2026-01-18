import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { match, P } from 'ts-pattern';
import { invalidatePhotoGalleryQueries } from '@/queryClient';
import { trpcReact } from '@/trpc';
import type { TypedTRPCError } from '../types/trpcErrors';

type ProcessStage = 'pending' | 'inProgress' | 'success' | 'error' | 'skipped';

/**
 * ローディング画面の最小表示時間（ミリ秒）
 * 処理が高速に完了してもローディング画面がフラッシュしないようにする
 */
const MIN_LOADING_DISPLAY_MS = 800;

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

interface UseStartupStageOptions extends ProcessStageCallbacks {
  /** subscription接続完了フラグ（trueになるまで初期化を開始しない） */
  isSubscriptionReady?: boolean;
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
export const useStartupStage = (options?: UseStartupStageOptions) => {
  const { isSubscriptionReady = false, ...callbacks } = options ?? {};
  const [stages, setStages] = useState<ProcessStages>(initialStages);
  const [error, setError] = useState<ProcessError | null>(null);

  // 初期化開始時刻を記録（最小表示時間保証用）
  const initStartTimeRef = useRef<number | null>(null);

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
        // 開始時刻を記録（最小表示時間保証用）
        initStartTimeRef.current = Date.now();
        updateStage('initialization', 'inProgress');
      },
      onSuccess: async () => {
        // 最小表示時間を保証してから success に遷移
        // onMutate で設定済み、未設定時は経過時間0として扱う
        const elapsed = Date.now() - (initStartTimeRef.current ?? Date.now());
        const remaining = MIN_LOADING_DISPLAY_MS - elapsed;
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }

        updateStage('initialization', 'success');

        // ログ同期完了後、ログ関連のクエリキャッシュを無効化
        try {
          invalidatePhotoGalleryQueries(utils);
        } catch (error) {
          console.warn('Failed to invalidate query cache:', error);
        }

        // 初期化完了を通知
        callbacks?.onComplete?.();
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

  // ミューテーションをrefで保持し、retryProcess の安定した参照を維持する
  const mutationRef = useRef(initializeAppDataMutation);
  mutationRef.current = initializeAppDataMutation;

  // 初期化処理を開始
  // mutation.isIdle = 未実行または reset() 済み
  const startInitialization = useCallback(() => {
    const mutation = mutationRef.current;
    match({
      stage: stages.initialization,
      isIdle: mutation.isIdle,
    })
      .with({ stage: 'pending', isIdle: true }, () => {
        mutation.mutate();
      })
      .otherwise(() => {});
  }, [stages.initialization]);

  // 自動的に初期化を開始（subscription接続完了後）
  useEffect(() => {
    if (isSubscriptionReady) {
      startInitialization();
    }
  }, [isSubscriptionReady, startInitialization]);

  // リトライ処理
  const retryProcess = useCallback(() => {
    setStages(initialStages);
    setError(null);
    mutationRef.current.reset();
    // startInitialization は useEffect で自動的に呼ばれる
  }, []);

  // 完了判定
  const completed = useMemo(
    () => stages.initialization === 'success',
    [stages],
  );

  // 終了判定（成功またはエラー）
  const finished = useMemo(
    () =>
      match(stages.initialization)
        .with(P.union('success', 'error'), () => true)
        .otherwise(() => false),
    [stages],
  );

  // 返り値オブジェクトをメモ化して、不要な再レンダリングを防ぐ
  return useMemo(
    () => ({
      stages,
      updateStage,
      errorMessage: error?.message ?? '',
      errorStage: error?.stage ?? '',
      originalError: error?.originalError,
      retryProcess,
      completed,
      finished,
    }),
    [
      stages,
      updateStage,
      error?.message,
      error?.stage,
      error?.originalError,
      retryProcess,
      completed,
      finished,
    ],
  );
};
