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
    isIdle: boolean;
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
      isIdle: true, // 初期状態では isIdle = true
    };

    // デフォルトのモック設定
    mockTrpcReact.settings.initializeAppData.useMutation.mockReturnValue(
      mockMutation,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('初期状態では initialization が pending になる', () => {
    const { result } = renderHook(() => useStartupStage(mockCallbacks));

    expect(result.current.stages.initialization).toBe('pending');
    expect(result.current.completed).toBe(false);
    expect(result.current.finished).toBe(false);
  });

  it('isSubscriptionReady=false の場合、初期化は開始されない', async () => {
    renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: false }),
    );

    // 少し待ってからmutateが呼ばれていないことを確認
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('isSubscriptionReady=true の場合、自動的に初期化ミューテーションが実行される', async () => {
    renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
  });

  it('ミューテーション実行中は inProgress になる', async () => {
    const { result } = renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

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

  it('ミューテーション成功時は success になる（最小表示時間経過後）', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];

    act(() => {
      mutationOptions.onMutate();
    });

    // onSuccess を開始（非同期）
    let successPromise: Promise<void>;
    act(() => {
      successPromise = mutationOptions.onSuccess();
    });

    // 最小表示時間前は inProgress のまま
    expect(result.current.stages.initialization).toBe('inProgress');

    // 最小表示時間を経過させる
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await successPromise;
    });

    expect(result.current.stages.initialization).toBe('success');
    expect(result.current.completed).toBe(true);
    expect(result.current.finished).toBe(true);

    vi.useRealTimers();
  });

  it('処理が最小表示時間より長い場合は追加の待機なし', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];

    act(() => {
      mutationOptions.onMutate();
    });

    // 最小表示時間より長く待つ（実際の処理時間をシミュレート）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // onSuccess を呼び出す（既に最小表示時間を超えているので即座に完了）
    await act(async () => {
      await mutationOptions.onSuccess();
    });

    expect(result.current.stages.initialization).toBe('success');
    expect(result.current.completed).toBe(true);

    vi.useRealTimers();
  });

  it('ミューテーション失敗時は error になる', async () => {
    const { result } = renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

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
    const { result } = renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

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
    const { result } = renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

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
    const { result } = renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

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
      isIdle: false, // 実行中は isIdle = false
    };

    mockTrpcReact.settings.initializeAppData.useMutation.mockReturnValue(
      loadingMutation,
    );

    renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

    // 少し待ってからmutateが呼ばれていないことを確認
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('成功完了後は再実行されない', async () => {
    // isSuccess = true の状態をモック
    const successMutation = {
      ...mockMutation,
      isSuccess: true,
      isIdle: false, // 成功後は isIdle = false
    };

    mockTrpcReact.settings.initializeAppData.useMutation.mockReturnValue(
      successMutation,
    );

    renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

    // 少し待ってからmutateが呼ばれていないことを確認
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('完了時にコールバックが実行される', async () => {
    vi.useFakeTimers();

    renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

    const mutationOptions =
      mockTrpcReact.settings.initializeAppData.useMutation.mock.calls[0][0];

    act(() => {
      mutationOptions.onMutate();
    });

    // onSuccess を開始して最小表示時間を経過させる
    let successPromise: Promise<void>;
    act(() => {
      successPromise = mutationOptions.onSuccess();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await successPromise;
    });

    // onComplete は useEffect で呼ばれるため、次のレンダリングサイクルを待つ
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockCallbacks.onComplete).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('エラー時にコールバックが実行される', async () => {
    renderHook(() =>
      useStartupStage({ ...mockCallbacks, isSubscriptionReady: true }),
    );

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
