import { trpcReact } from '@/trpc';
import type React from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

interface Props {
  children: React.ReactNode;
}

const ErrorFallback: React.FC<{
  error: Error;
  resetErrorBoundary: () => void;
}> = ({ error, resetErrorBoundary }) => {
  const reloadMutation = trpcReact.electronUtil.reloadWindow.useMutation();

  const handleRetry = () => {
    reloadMutation.mutate();
    resetErrorBoundary();
  };

  return (
    <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900">
      <div className="text-center p-4 max-w-md mx-auto">
        <h2 className="text-xl font-semibold text-red-600 dark:text-red-400">
          予期せぬエラーが発生しました
        </h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          {error.message || 'アプリケーションで問題が発生しました'}
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          再読み込みを試してください
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          再読み込み
        </button>
      </div>
    </div>
  );
};

export const ErrorBoundary: React.FC<Props> = ({ children }) => {
  const onError = (error: Error, info: React.ErrorInfo) => {
    console.error('エラーバウンダリーでエラーをキャッチしました:', error, info);
  };

  return (
    <ReactErrorBoundary FallbackComponent={ErrorFallback} onError={onError}>
      {children}
    </ReactErrorBoundary>
  );
};
