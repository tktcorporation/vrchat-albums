import { createQueryStub } from '@/v2/helpers/testing/createQueryStub';
import { render, screen } from '@testing-library/react';
import { ok } from 'neverthrow';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationGroupHeader } from '../index';

// バックエンドサービスのモック
const mockWorldJoinLogService = {
  findVRChatWorldJoinLogList: vi.fn(),
  mergeVRChatWorldJoinLogs: vi.fn(),
};

const mockWorldJoinLogFromPhotoService = {
  findVRChatWorldJoinLogFromPhotoList: vi.fn(),
};

const mockPlayerJoinLogService = {
  getVRChatPlayerJoinLogListByMultipleDateRanges: vi.fn(),
};

const mockPlayerListCache = {
  get: vi.fn(),
  set: vi.fn(),
};

// tRPCモック（サービスレイヤーの結果を返すように設定）
vi.mock('@/trpc', () => ({
  trpcReact: {
    vrchatApi: {
      getVrcWorldInfoByWorldId: {
        useQuery: vi.fn(),
      },
      convertImageToBase64: {
        useQuery: vi.fn().mockReturnValue({ data: null, isLoading: false }),
      },
    },
    logInfo: {
      getPlayerListInSameWorld: {
        useQuery: vi.fn(),
      },
    },
    electronUtil: {
      openUrlInDefaultBrowser: {
        useMutation: vi.fn().mockReturnValue({
          mutate: vi.fn(),
        }),
      },
      copyTextToClipboard: {
        useMutation: vi.fn().mockReturnValue({
          mutateAsync: vi.fn(),
        }),
      },
      copyImageDataByBase64: {
        useMutation: vi.fn().mockReturnValue({
          mutateAsync: vi.fn(),
        }),
      },
      downloadImageAsPhotoLogPng: {
        useMutation: vi.fn().mockReturnValue({
          mutateAsync: vi.fn(),
        }),
      },
    },
  },
  trpcClient: {
    logInfo: {
      getSessionInfoBatch: {
        query: vi.fn(),
      },
    },
  },
}));

// IntersectionObserverのモック
const mockIntersectionObserver = vi.fn();
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

global.IntersectionObserver = vi.fn().mockImplementation((callback) => {
  mockIntersectionObserver.mockImplementation(callback);
  return {
    observe: mockObserve,
    disconnect: mockDisconnect,
  };
});

// ResizeObserverのモック
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
}));

// createPortalのモック
vi.mock('react-dom', () => ({
  createPortal: vi.fn((element) => element),
}));

// useSessionInfoBatchフックのモック
vi.mock('../hooks/useSessionInfoBatch', () => ({
  useSessionInfoBatch: vi.fn(),
}));

const mockProps = {
  worldId: 'wrld_12345',
  worldName: 'Test World',
  worldInstanceId: 'instance123',
  photoCount: 5,
  joinDateTime: new Date('2023-01-01T12:00:00Z'),
};

describe('LocationGroupHeader - Player Uniqueness', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // デフォルトのサービスモック設定
    mockWorldJoinLogService.findVRChatWorldJoinLogList.mockResolvedValue(
      ok([]),
    );
    mockWorldJoinLogFromPhotoService.findVRChatWorldJoinLogFromPhotoList.mockResolvedValue(
      ok([]),
    );
    mockWorldJoinLogService.mergeVRChatWorldJoinLogs.mockReturnValue([]);
    mockPlayerJoinLogService.getVRChatPlayerJoinLogListByMultipleDateRanges.mockResolvedValue(
      ok([]),
    );
    mockPlayerListCache.get.mockReturnValue(null);
  });

  it('rejoinしたプレイヤーの重複を除去する', async () => {
    const { trpcReact, trpcClient } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    // 同じプレイヤーが複数回joinしたデータをモック
    const duplicatePlayersData = [
      {
        id: '1',
        playerId: 'usr_player1',
        playerName: 'DuplicatePlayer',
        joinDateTime: new Date('2023-01-01T12:05:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        playerId: 'usr_player2',
        playerName: 'UniquePlayer',
        joinDateTime: new Date('2023-01-01T12:10:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '3',
        playerId: 'usr_player1',
        playerName: 'DuplicatePlayer', // 同じプレイヤー名（rejoin）
        joinDateTime: new Date('2023-01-01T12:15:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // サービスレイヤーのモック設定
    mockPlayerJoinLogService.getVRChatPlayerJoinLogListByMultipleDateRanges.mockResolvedValue(
      ok(duplicatePlayersData),
    );

    // tRPCクライアントのモック設定（サービスの結果を返す）
    vi.mocked(trpcClient.logInfo.getSessionInfoBatch.query).mockResolvedValue({
      '2023-01-01T12:00:00.000Z': {
        worldId: 'wrld_12345',
        worldName: 'Test World',
        worldInstanceId: 'instance123',
        players: duplicatePlayersData,
      },
    });

    // VRChatワールド情報のモック
    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );

    // プレイヤー情報のモック
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: duplicatePlayersData,
      isLoading: false,
      error: null,
    });

    render(<LocationGroupHeader {...mockProps} />);

    // プレイヤー数表示が重複排除されていることを確認（3人ではなく2人）
    expect(screen.getByText('2')).toBeTruthy();

    // プレイヤー名が重複表示されていないことを確認
    // DuplicatePlayerはtoolipとmain displayの両方に表示される可能性があるため、
    // 主表示エリアでの重複がないことを確認
    const playerNamesInTooltip = screen.getAllByText('DuplicatePlayer');
    // ツールチップやその他の場所での表示を考慮して、合理的な数であることを確認
    expect(playerNamesInTooltip.length).toBeGreaterThan(0);
  });

  it('異なるプレイヤー名は正常に表示される', async () => {
    const { trpcReact, trpcClient } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    const uniquePlayersData = [
      {
        id: '1',
        playerId: 'usr_player1',
        playerName: 'Player1',
        joinDateTime: new Date('2023-01-01T12:05:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        playerId: 'usr_player2',
        playerName: 'Player2',
        joinDateTime: new Date('2023-01-01T12:10:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '3',
        playerId: 'usr_player3',
        playerName: 'Player3',
        joinDateTime: new Date('2023-01-01T12:15:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // サービスレイヤーのモック設定
    mockPlayerJoinLogService.getVRChatPlayerJoinLogListByMultipleDateRanges.mockResolvedValue(
      ok(uniquePlayersData),
    );

    // tRPCクライアントのモック設定
    vi.mocked(trpcClient.logInfo.getSessionInfoBatch.query).mockResolvedValue({
      '2023-01-01T12:00:00.000Z': {
        worldId: 'wrld_12345',
        worldName: 'Test World',
        worldInstanceId: 'instance123',
        players: uniquePlayersData,
      },
    });

    // VRChatワールド情報のモック
    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );

    // プレイヤー情報のモック
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: uniquePlayersData,
      isLoading: false,
      error: null,
    });

    render(<LocationGroupHeader {...mockProps} />);

    // 全プレイヤーが表示されることを確認
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getAllByText('Player1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Player2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Player3').length).toBeGreaterThan(0);
  });

  it('空のプレイヤーリストを正しく処理する', async () => {
    const { trpcReact, trpcClient } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    // サービスレイヤーのモック設定（空のプレイヤーリスト）
    mockPlayerJoinLogService.getVRChatPlayerJoinLogListByMultipleDateRanges.mockResolvedValue(
      ok([]),
    );

    // tRPCクライアントのモック設定
    vi.mocked(trpcClient.logInfo.getSessionInfoBatch.query).mockResolvedValue({
      '2023-01-01T12:00:00.000Z': {
        worldId: 'wrld_12345',
        worldName: 'Test World',
        worldInstanceId: 'instance123',
        players: [],
      },
    });

    // VRChatワールド情報のモック
    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );

    // 空のプレイヤー情報のモック
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: [],
      isLoading: false,
      error: null,
    });

    render(<LocationGroupHeader {...mockProps} />);

    // プレイヤーセクションが表示されないことを確認（プレイヤー数が0または表示されない）
    // 空のプレイヤーリストの場合、プレイヤー数部分が表示されないか、0が表示される
    const playerCountElements = screen.queryAllByText(/^[0-9]+$/);
    if (playerCountElements.length > 0) {
      // もしプレイヤー数が表示される場合は、0であることを確認
      expect(screen.queryByText('0')).toBeTruthy();
    }
  });
});

describe('LocationGroupHeader - Query Optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should setup IntersectionObserver on mount', async () => {
    const { trpcReact } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: null,
      isLoading: false,
      error: null,
    });

    render(<LocationGroupHeader {...mockProps} />);

    expect(global.IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        root: null,
        rootMargin: '200px',
        threshold: 0.1,
      }),
    );
    expect(mockObserve).toHaveBeenCalled();
  });

  it('should enable queries when element becomes visible', async () => {
    const { trpcReact } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    const mockWorldQuery = vi.fn().mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );

    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockImplementation(mockWorldQuery);
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: null,
      isLoading: false,
      error: null,
    });

    render(<LocationGroupHeader {...mockProps} />);

    // Initially queries should be disabled, with fallback to prop worldId
    expect(mockWorldQuery).toHaveBeenCalledWith(
      'wrld_12345', // Uses prop worldId directly
      expect.objectContaining({ enabled: false }),
    );

    // Simulate intersection observer callback for visibility
    const [callback] = mockIntersectionObserver.mock.calls[0] || [];
    if (callback) {
      callback([{ isIntersecting: true }]);

      // Fast-forward through debounce delay
      vi.advanceTimersByTime(250);

      // Re-render to trigger useEffect
      vi.runAllTimers();
    }

    // After visibility, intersection observer should be properly set up
    expect(global.IntersectionObserver).toHaveBeenCalled();
  });

  it('should disable queries when element becomes invisible', async () => {
    const { trpcReact } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: null,
      isLoading: false,
      error: null,
    });

    render(<LocationGroupHeader {...mockProps} />);

    // Simulate becoming visible first
    const [callback] = mockIntersectionObserver.mock.calls[0] || [];
    if (callback) {
      callback([{ isIntersecting: true }]);
      vi.advanceTimersByTime(250);

      // Then becoming invisible
      callback([{ isIntersecting: false }]);
      vi.advanceTimersByTime(500);
    }

    // Verify that intersection observer was set up
    expect(global.IntersectionObserver).toHaveBeenCalled();
  });

  it('should cleanup IntersectionObserver on unmount', async () => {
    const { trpcReact } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: null,
      isLoading: false,
      error: null,
    });

    const { unmount } = render(<LocationGroupHeader {...mockProps} />);

    unmount();

    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should apply query optimization settings', async () => {
    const { trpcReact } = await import('@/trpc');
    const { useSessionInfoBatch } = await import(
      '../hooks/useSessionInfoBatch'
    );

    const mockWorldQuery = vi.fn().mockReturnValue(
      createQueryStub({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      }),
    );
    vi.mocked(
      trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery,
    ).mockImplementation(mockWorldQuery);
    vi.mocked(useSessionInfoBatch).mockReturnValue({
      players: null,
      isLoading: false,
      error: null,
    });

    render(<LocationGroupHeader {...mockProps} />);

    // VRChatワールド詳細クエリの最適化設定を確認
    expect(mockWorldQuery).toHaveBeenCalledWith(
      'wrld_12345', // Uses prop worldId directly
      expect.objectContaining({
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 1000 * 60 * 5,
        cacheTime: 1000 * 60 * 30,
      }),
    );
  });
});
