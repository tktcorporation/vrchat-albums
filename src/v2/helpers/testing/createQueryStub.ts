import { vi } from 'vitest';

/**
 * tRPC の useQuery フックの戻り値をモックするためのヘルパー関数
 *
 * 注意: tRPCは公式のテストヘルパーを提供していないため、このカスタムヘルパーを使用します。
 * tRPCの`UseTRPCQueryResult`型は@tanstack/react-queryの型と複雑に結合しており、
 * 完全な型互換性を持つモックの作成は困難です。
 *
 * このヘルパーは実用的なサブセットのプロパティを提供し、テストで必要な
 * 基本的な機能をカバーします。
 *
 * @param overrides - 上書きしたいプロパティ
 * @returns tRPC useQuery モックオブジェクト（型はanyですが、実際の構造は正確です）
 */
export function createQueryStub<TData = unknown, TError = unknown>(
  overrides: Partial<{
    data: TData | null | undefined;
    isLoading: boolean;
    error: TError | null;
    refetch: () => void;
    isFetching: boolean;
    isError: boolean;
    isSuccess: boolean;
  }> = {},
  // biome-ignore lint/suspicious/noExplicitAny: tRPCの完全な型定義との互換性は複雑すぎるため、実用的なアプローチとしてanyを使用
): any {
  const {
    data = undefined,
    isLoading = false,
    error = null,
    refetch = vi.fn(),
    isFetching = false,
    isError = false,
  } = overrides;

  // 基本的なプロパティ
  const baseResult = {
    data: data as TData | undefined,
    error: error,
    // biome-ignore lint/suspicious/noExplicitAny: refetch function has complex overloads that are difficult to type
    refetch: refetch as any,
    isFetching,
    isPaused: false,
    isStale: false,
    isFetched: !isLoading,
    isFetchedAfterMount: !isLoading,
    isRefetching: false,
    isLoadingError: isLoading && isError,
    isRefetchError: false,
    isInitialLoading: isLoading && !data,
    isPlaceholderData: false,
    isPreviousData: false,
    dataUpdatedAt: data ? Date.now() : 0,
    errorUpdatedAt: error ? Date.now() : 0,
    failureCount: error ? 1 : 0,
    failureReason: error,
    errorUpdateCount: error ? 1 : 0,
    remove: vi.fn(),
    // tRPC specific properties
    trpc: {
      path: '',
      abortOnUnmount: false,
    },
  };

  // 状態に応じた返却
  if (isLoading) {
    return {
      ...baseResult,
      isLoading: true,
      isError: false,
      isSuccess: false,
      status: 'loading' as const,
      fetchStatus: isFetching ? ('fetching' as const) : ('idle' as const),
      data: undefined,
      error: null,
    };
  }

  if (isError) {
    return {
      ...baseResult,
      isLoading: false,
      isError: true,
      isSuccess: false,
      status: 'error' as const,
      fetchStatus: isFetching ? ('fetching' as const) : ('idle' as const),
      error: error as TError,
    };
  }

  return {
    ...baseResult,
    isLoading: false,
    isError: false,
    isSuccess: true,
    status: 'success' as const,
    fetchStatus: isFetching ? ('fetching' as const) : ('idle' as const),
    data: data as TData,
    error: null,
  };
}
