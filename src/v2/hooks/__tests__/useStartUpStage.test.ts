import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// trpcReactのモック
vi.mock('@/trpc', () => ({
  trpcReact: {
    settings: {
      initializeAppData: {
        useMutation: vi.fn(),
      },
    },
    useUtils: vi.fn(() => ({
      // useUtilsのモック実装
    })),
  },
}));

// queryClientのモック
vi.mock('@/queryClient', () => ({
  invalidatePhotoGalleryQueries: vi.fn(),
}));

// テスト内でのtRPCモックのアクセス
import { trpcReact } from '@/trpc';
import { useStartupStage } from '../useStartUpStage';

// モック型の定義
interface MockTrpcReact {
  settings: {
    initializeAppData: {
      useMutation: ReturnType<typeof vi.fn>;
    };
  };
  useUtils: ReturnType<typeof vi.fn>;
}

const mockTrpcReact = trpcReact as unknown as MockTrpcReact;

describe('useStartupStage - simplified implementation', () => {
  const mockCallbacks = {
    onError: vi.fn(),
    onComplete: vi.fn(),
  };

  let mockMutate: ReturnType<typeof vi.fn>;
  let mockReset: ReturnType<typeof vi.fn>;
  let mockMutation: {
    mutate: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    isPending: boolean;
    isSuccess: boolean;
    isError: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMutate = vi.fn();
    mockReset = vi.fn();

    mockMutation = {
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isSuccess: false,
      isError: false,
    };

    // デフォルトのモック設定
    mockTrpcReact.settings.initializeAppData.useMutation.mockReturnValue(
      mockMutation,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初期状態では initialization が pending になる', () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    expect(result.current.stages.initialization).toBe('pending');
    expect(result.current.completed).toBe(false);
    expect(result.current.finished).toBe(false);
  });

  it('自動的に初期化ミューテーションが実行される', async () => {
    renderHook(() => useStartupStage(mockCallbacks));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
  });

  it('ミューテーション実行中は inProgress になる', async () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    // onMutateコールバックを手動で実行
    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];

    act(() => {
      mutationOptions.onMutate();
    });

    expect(result.current.stages.initialization).toBe('inProgress');
    expect(result.current.completed).toBe(false);
    expect(result.current.finished).toBe(false);
  });

  it('ミューテーション成功時は success になる', async () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];

    act(() => {
      mutationOptions.onMutate();
    });

    act(() => {
      mutationOptions.onSuccess();
    });

    expect(result.current.stages.initialization).toBe('success');
    expect(result.current.completed).toBe(true);
    expect(result.current.finished).toBe(true);
  });

  it('ミューテーション失敗時は error になる', async () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];
    const testError = new Error('Test initialization error');

    act(() => {
      mutationOptions.onMutate();
    });

    act(() => {
      mutationOptions.onError(testError);
    });

    expect(result.current.stages.initialization).toBe('error');
    expect(result.current.completed).toBe(false);
    expect(result.current.finished).toBe(true);
    expect(result.current.errorMessage).toBe('Test initialization error');
  });

  it('重複実行エラーの場合は無視される', async () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];
    const duplicateError = new Error('初期化処理が既に実行中です');

    act(() => {
      mutationOptions.onMutate();
    });

    act(() => {
      mutationOptions.onError(duplicateError);
    });

    // エラー状態にならないことを確認
    expect(result.current.stages.initialization).toBe('inProgress');
    expect(result.current.errorMessage).toBe('');
  });

  it('LOG_DIRECTORY_ERROR エラーは適切にハンドリングされる', async () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];
    const directoryError = new Error(
      'LOG_DIRECTORY_ERROR: VRChatのログフォルダが見つかりません',
    );

    act(() => {
      mutationOptions.onMutate();
    });

    act(() => {
      mutationOptions.onError(directoryError);
    });

    expect(result.current.stages.initialization).toBe('error');
    expect(result.current.errorMessage).toBe(
      'LOG_DIRECTORY_ERROR: VRChatのログフォルダが見つかりません',
    );
  });

  it('retryProcess実行時にリセットされる', async () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    // エラー状態にする
    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];
    const testError = new Error('Test error');

    act(() => {
      mutationOptions.onMutate();
    });

    act(() => {
      mutationOptions.onError(testError);
    });

    expect(result.current.stages.initialization).toBe('error');

    // リトライ実行
    act(() => {
      result.current.retryProcess();
    });

    expect(result.current.stages.initialization).toBe('pending');
    expect(result.current.errorMessage).toBe('');
    expect(mockReset).toHaveBeenCalled();
  });

  it('重複実行防止が機能する', async () => {
    // isPending = true の状態をモック
    const loadingMutation = {
      ...mockMutation,
      isPending: true,
    };

    mockTrpcReact.settings.initializeAppData.useMutation.mockReturnValue(
      loadingMutation,
    );

    renderHook(() => useStartupStage(mockCallbacks));

    // 少し待ってからmutateが呼ばれていないことを確認
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('成功完了後は再実行されない', async () => {
    // isSuccess = true の状態をモック
    const successMutation = {
      ...mockMutation,
      isSuccess: true,
    };

    mockTrpcReact.settings.initializeAppData.useMutation.mockReturnValue(
      successMutation,
    );

    renderHook(() => useStartupStage(mockCallbacks));

    // 少し待ってからmutateが呼ばれていないことを確認
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('完了時にコールバックが実行される', async () => {
    renderHook(() => useStartupStage(mockCallbacks));

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];

    act(() => {
      mutationOptions.onMutate();
    });

    act(() => {
      mutationOptions.onSuccess();
    });

    await waitFor(() => {
      expect(mockCallbacks.onComplete).toHaveBeenCalled();
    });
  });

  it('エラー時にコールバックが実行される', async () => {
    renderHook(() => useStartupStage(mockCallbacks));

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];
    const testError = new Error('Test error');

    act(() => {
      mutationOptions.onMutate();
    });

    act(() => {
      mutationOptions.onError(testError);
    });

    await waitFor(() => {
      expect(mockCallbacks.onError).toHaveBeenCalledWith({
        stage: 'initialization',
        message: 'Test error',
        originalError: testError,
      });
    });
  });
});
