import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllListeners,
  getListenerCount,
  notifyCacheUpdate,
  subscribeToCacheUpdate,
} from '../../services/thumbnailEventEmitter';

// Mock tRPC
const mockFetch = vi.fn();
vi.mock('@/trpc', () => ({
  trpcReact: {
    useUtils: () => ({
      vrchatPhoto: {
        getBatchThumbnails: {
          fetch: mockFetch,
        },
      },
    }),
  },
}));

// LRUCacheをテストするためにモジュール内部にアクセス
// 実際のテストでは、useThumbnailCache経由でテスト

describe('thumbnailEventEmitter', () => {
  beforeEach(() => {
    clearAllListeners();
  });

  afterEach(() => {
    clearAllListeners();
    vi.clearAllMocks();
  });

  describe('subscribeToCacheUpdate', () => {
    it('リスナーを登録できる', () => {
      const listener = vi.fn();
      const photoPath = '/test/photo.png';

      subscribeToCacheUpdate(photoPath, listener);

      expect(getListenerCount(photoPath)).toBe(1);
    });

    it('同じパスに複数のリスナーを登録できる', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const photoPath = '/test/photo.png';

      subscribeToCacheUpdate(photoPath, listener1);
      subscribeToCacheUpdate(photoPath, listener2);

      expect(getListenerCount(photoPath)).toBe(2);
    });

    it('異なるパスにリスナーを登録できる', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const path1 = '/test/photo1.png';
      const path2 = '/test/photo2.png';

      subscribeToCacheUpdate(path1, listener1);
      subscribeToCacheUpdate(path2, listener2);

      expect(getListenerCount(path1)).toBe(1);
      expect(getListenerCount(path2)).toBe(1);
    });

    it('アンサブスクライブでリスナーが削除される', () => {
      const listener = vi.fn();
      const photoPath = '/test/photo.png';

      const unsubscribe = subscribeToCacheUpdate(photoPath, listener);
      expect(getListenerCount(photoPath)).toBe(1);

      unsubscribe();
      expect(getListenerCount(photoPath)).toBe(0);
    });

    it('最後のリスナーが削除されるとセットもクリアされる', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const photoPath = '/test/photo.png';

      const unsub1 = subscribeToCacheUpdate(photoPath, listener1);
      const unsub2 = subscribeToCacheUpdate(photoPath, listener2);

      unsub1();
      expect(getListenerCount(photoPath)).toBe(1);

      unsub2();
      expect(getListenerCount(photoPath)).toBe(0);
    });
  });

  describe('notifyCacheUpdate', () => {
    it('登録されたリスナーにデータを通知する', () => {
      const listener = vi.fn();
      const photoPath = '/test/photo.png';
      const data = 'base64data';

      subscribeToCacheUpdate(photoPath, listener);
      notifyCacheUpdate(photoPath, data);

      expect(listener).toHaveBeenCalledWith(data);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('同じパスの全リスナーに通知する', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const photoPath = '/test/photo.png';
      const data = 'base64data';

      subscribeToCacheUpdate(photoPath, listener1);
      subscribeToCacheUpdate(photoPath, listener2);
      notifyCacheUpdate(photoPath, data);

      expect(listener1).toHaveBeenCalledWith(data);
      expect(listener2).toHaveBeenCalledWith(data);
    });

    it('異なるパスのリスナーには通知しない', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const path1 = '/test/photo1.png';
      const path2 = '/test/photo2.png';
      const data = 'base64data';

      subscribeToCacheUpdate(path1, listener1);
      subscribeToCacheUpdate(path2, listener2);
      notifyCacheUpdate(path1, data);

      expect(listener1).toHaveBeenCalledWith(data);
      expect(listener2).not.toHaveBeenCalled();
    });

    it('リスナーがない場合はエラーにならない', () => {
      expect(() => {
        notifyCacheUpdate('/nonexistent/path.png', 'data');
      }).not.toThrow();
    });

    it('アンサブスクライブ後は通知されない', () => {
      const listener = vi.fn();
      const photoPath = '/test/photo.png';

      const unsubscribe = subscribeToCacheUpdate(photoPath, listener);
      unsubscribe();
      notifyCacheUpdate(photoPath, 'data');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('clearAllListeners', () => {
    it('全てのリスナーをクリアする', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const path1 = '/test/photo1.png';
      const path2 = '/test/photo2.png';

      subscribeToCacheUpdate(path1, listener1);
      subscribeToCacheUpdate(path2, listener2);

      clearAllListeners();

      expect(getListenerCount(path1)).toBe(0);
      expect(getListenerCount(path2)).toBe(0);
    });
  });
});

describe('useThumbnailCache', () => {
  beforeEach(() => {
    clearAllListeners();
    mockFetch.mockReset();
  });

  afterEach(() => {
    clearAllListeners();
    vi.clearAllMocks();
  });

  // Note: useThumbnailCache uses a global cache, so tests may affect each other
  // In a real-world scenario, we'd need to reset the global cache between tests

  it('should be importable', async () => {
    const { useThumbnailCache } = await import('../useThumbnailCache');
    expect(useThumbnailCache).toBeDefined();
  });

  describe('getThumbnail', () => {
    it('キャッシュにないパスはundefinedを返す', async () => {
      const { useThumbnailCache } = await import('../useThumbnailCache');

      const { result } = renderHook(() => useThumbnailCache());

      // Use a unique path to avoid cache conflicts
      const uniquePath = `/test/uncached-${Date.now()}.png`;
      expect(result.current.getThumbnail(uniquePath)).toBeUndefined();
    });

    it('setThumbnailでキャッシュに保存した値を取得できる', async () => {
      const { useThumbnailCache } = await import('../useThumbnailCache');

      const { result } = renderHook(() => useThumbnailCache());

      const uniquePath = `/test/cached-${Date.now()}.png`;
      const data = 'base64thumbnaildata';

      act(() => {
        result.current.setThumbnail(uniquePath, data);
      });

      expect(result.current.getThumbnail(uniquePath)).toBe(data);
    });
  });

  describe('cacheSize', () => {
    it('setThumbnail後にcacheSizeが更新される', async () => {
      const { useThumbnailCache } = await import('../useThumbnailCache');

      const { result } = renderHook(() => useThumbnailCache());

      const initialSize = result.current.cacheSize;

      act(() => {
        result.current.setThumbnail(
          `/test/size-test-${Date.now()}.png`,
          'data',
        );
      });

      expect(result.current.cacheSize).toBeGreaterThanOrEqual(initialSize);
    });
  });

  describe('clearCache', () => {
    it('キャッシュをクリアするとcacheSizeが0になる', async () => {
      const { useThumbnailCache } = await import('../useThumbnailCache');

      const { result } = renderHook(() => useThumbnailCache());

      act(() => {
        result.current.setThumbnail(
          `/test/clear-test-${Date.now()}.png`,
          'data',
        );
      });

      act(() => {
        result.current.clearCache();
      });

      expect(result.current.cacheSize).toBe(0);
    });
  });
});

describe('useThumbnail', () => {
  beforeEach(() => {
    clearAllListeners();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue([]);
  });

  afterEach(() => {
    clearAllListeners();
    vi.clearAllMocks();
  });

  it('enabledがfalseの場合はフェッチしない', async () => {
    const { useThumbnail } = await import('../useThumbnailCache');

    renderHook(() => useThumbnail('/test/disabled.png', false));

    // Wait a bit for any async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('photoPathが空の場合はフェッチしない', async () => {
    const { useThumbnail } = await import('../useThumbnailCache');

    renderHook(() => useThumbnail('', true));

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('キャッシュ更新イベントを受け取るとstateが更新される', async () => {
    const { useThumbnail, useThumbnailCache } = await import(
      '../useThumbnailCache'
    );

    // First, clear the cache
    const { result: cacheResult } = renderHook(() => useThumbnailCache());
    act(() => {
      cacheResult.current.clearCache();
    });

    const uniquePath = `/test/event-update-${Date.now()}.png`;
    const expectedData = 'updated-base64-data';

    const { result } = renderHook(() => useThumbnail(uniquePath, true));

    // Initially undefined
    expect(result.current).toBeUndefined();

    // Notify cache update
    act(() => {
      notifyCacheUpdate(uniquePath, expectedData);
    });

    // Wait for state update
    await waitFor(() => {
      expect(result.current).toBe(expectedData);
    });
  });
});
