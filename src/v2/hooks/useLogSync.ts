import { invalidatePhotoGalleryQueries } from '@/queryClient';
import { trpcReact } from '@/trpc';
import { useToast } from './use-toast';

/**
 * ログ同期のモード定義
 */
export const LOG_SYNC_MODE = {
  /**
   * 全件処理モード
   * - 初回起動時
   * - 設定画面からの手動更新時
   */
  FULL: 'FULL',
  /**
   * 差分処理モード
   * - 通常の更新時
   * - バックグラウンド更新時
   */
  INCREMENTAL: 'INCREMENTAL',
} as const;

export type LogSyncMode = (typeof LOG_SYNC_MODE)[keyof typeof LOG_SYNC_MODE];

interface UseLogSyncOptions {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * ログの同期処理を統一的に扱うカスタムフック
 * appendLoglines → loadLogInfo の順序を保証する
 */
export const useLogSync = (options?: UseLogSyncOptions) => {
  const { toast: showToast } = useToast();
  const utils = trpcReact.useUtils();

  const syncLogsMutation = trpcReact.logSync.syncLogs.useMutation({
    onSuccess: () => {
      // キャッシュの無効化
      invalidatePhotoGalleryQueries(utils);
      options?.onSuccess?.();
    },
    onError: (error) => {
      showToast({
        variant: 'destructive',
        title: 'ログ同期に失敗しました',
        description: error.message,
      });
      options?.onError?.(error);
    },
  });

  /**
   * ログの同期を実行する
   * @param mode 同期モード (FULL: 全件処理, INCREMENTAL: 差分処理)
   */
  const sync = async (mode: LogSyncMode) => {
    await syncLogsMutation.mutateAsync({ mode });
  };

  return {
    sync,
    isLoading: syncLogsMutation.isPending,
    isError: syncLogsMutation.isError,
    error: syncLogsMutation.error,
  };
};
