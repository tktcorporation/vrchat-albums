import type React from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { match, P } from 'ts-pattern';

import { trpcReact } from '@/trpc';

import { useI18n } from '../i18n/store';

interface Props {
  children: React.ReactNode;
}

const getErrorMessage = (error: unknown): string =>
  match(error)
    .with(P.instanceOf(Error), (e) => e.message)
    .with(P.string, (s) => s)
    .otherwise(() => 'アプリケーションで問題が発生しました');

/**
 * エラーバウンダリー発火時に表示するフォールバック UI コンポーネント。
 */
const ErrorFallback: React.FC<{
  error: unknown;
  resetErrorBoundary: () => void;
}> = ({ error, resetErrorBoundary }) => {
  const { t } = useI18n();
  const reloadMutation = trpcReact.electronUtil.reloadWindow.useMutation();

  /** エラー発生時にウィンドウをリロードして再試行する */
  const handleRetry = () => {
    reloadMutation.mutate();
    resetErrorBoundary();
  };

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-center p-4 max-w-md mx-auto">
        <h2 className="text-xl font-semibold text-destructive">
          {t('common.errorBoundary.title')}
        </h2>
        <p className="mt-2 text-muted-foreground">{getErrorMessage(error)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('common.errorBoundary.retryHint')}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors duration-150"
        >
          {t('common.errorBoundary.retry')}
        </button>
      </div>
    </div>
  );
};

/** 捕捉したエラー情報をコンソールに出力する */
const onBoundaryError = (error: unknown, info: React.ErrorInfo) => {
  console.error('エラーバウンダリーでエラーをキャッチしました:', error, info);
};

/**
 * ReactErrorBoundary を用いて子要素のレンダリングエラーを捕捉するコンポーネント。
 * 捕捉したエラーはログに出力されリロードボタンを提供する。
 */
export const ErrorBoundary: React.FC<Props> = ({ children }) => {
  return (
    <ReactErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={onBoundaryError}
    >
      {children}
    </ReactErrorBoundary>
  );
};
