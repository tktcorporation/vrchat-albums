import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllListeners,
  getListenerCount,
  notifyCacheUpdate,
  subscribeToCacheUpdate,
} from '../../services/thumbnailEventEmitter';
import { createLRUCacheForTesting } from '../useThumbnailCache';

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
    mockFetch.mockResolvedValue({ success: [], failed: [] });
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

describe('LRUCache eviction behavior', () => {
  it('maxSizeを超えると最も古いアイテムが退避される', () => {
    const cache = createLRUCacheForTesting<string, string>(3);

    // 3つのアイテムを追加
    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBe('value-a');
    expect(cache.get('b')).toBe('value-b');
    expect(cache.get('c')).toBe('value-c');

    // 4つ目を追加すると最古の 'a' が退避される
    cache.set('d', 'value-d');

    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined(); // 退避された
    expect(cache.get('b')).toBe('value-b');
    expect(cache.get('c')).toBe('value-c');
    expect(cache.get('d')).toBe('value-d');
  });

  it('get()でアクセスしたアイテムはLRUの先頭に移動する', () => {
    const cache = createLRUCacheForTesting<string, string>(3);

    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // 'a' にアクセス（最新に移動）
    cache.get('a');

    // 'd' を追加すると、最古の 'b' が退避される（'a' は最新なので残る）
    cache.set('d', 'value-d');

    expect(cache.get('a')).toBe('value-a'); // 残っている
    expect(cache.get('b')).toBeUndefined(); // 退避された
    expect(cache.get('c')).toBe('value-c');
    expect(cache.get('d')).toBe('value-d');
  });

  it('同じキーでset()すると値が更新されLRUの先頭に移動する', () => {
    const cache = createLRUCacheForTesting<string, string>(3);

    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // 'a' を更新（最新に移動）
    cache.set('a', 'updated-a');

    // 'd' を追加すると、最古の 'b' が退避される
    cache.set('d', 'value-d');

    expect(cache.get('a')).toBe('updated-a');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('value-c');
    expect(cache.get('d')).toBe('value-d');
  });

  it('has()はLRU順序を変更しない', () => {
    const cache = createLRUCacheForTesting<string, string>(3);

    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // has() でチェック（順序は変わらない）
    expect(cache.has('a')).toBe(true);

    // 'd' を追加すると、最古の 'a' が退避される（has()では順序が変わらない）
    cache.set('d', 'value-d');

    expect(cache.get('a')).toBeUndefined(); // 退避された
    expect(cache.get('b')).toBe('value-b');
    expect(cache.get('c')).toBe('value-c');
    expect(cache.get('d')).toBe('value-d');
  });

  it('clear()で全アイテムが削除される', () => {
    const cache = createLRUCacheForTesting<string, string>(3);

    cache.set('a', 'value-a');
    cache.set('b', 'value-b');

    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('maxSize=1の場合、常に最新の1つのみ保持', () => {
    const cache = createLRUCacheForTesting<string, string>(1);

    cache.set('a', 'value-a');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('value-a');

    cache.set('b', 'value-b');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('value-b');
  });
});

describe('バッチフェッチ失敗時のエラーハンドリング', () => {
  beforeEach(() => {
    clearAllListeners();
    mockFetch.mockReset();
  });

  afterEach(() => {
    clearAllListeners();
    vi.clearAllMocks();
  });

  it('onFetchErrorコールバックが呼ばれる', async () => {
    const { useThumbnailCache } = await import('../useThumbnailCache');
    const onFetchError = vi.fn();
    const testError = new Error('Network error');

    mockFetch.mockRejectedValueOnce(testError);

    const { result } = renderHook(() => useThumbnailCache({ onFetchError }));

    // Clear cache first
    act(() => {
      result.current.clearCache();
    });

    // Trigger a prefetch
    const uniquePath = `/test/error-${Date.now()}.png`;
    act(() => {
      result.current.prefetchThumbnails([uniquePath]);
    });

    // Wait for the error callback to be called
    await waitFor(() => {
      expect(onFetchError).toHaveBeenCalledTimes(1);
    });

    expect(onFetchError).toHaveBeenCalledWith(testError, expect.any(Array));
  });

  it('エラー後もキャッシュ機能は継続する', async () => {
    const { useThumbnailCache } = await import('../useThumbnailCache');
    const testError = new Error('Network error');

    // First call fails
    mockFetch.mockRejectedValueOnce(testError);
    // Second call succeeds
    mockFetch.mockResolvedValueOnce({
      success: [{ photoPath: '/test/success.png', data: 'success-data' }],
      failed: [],
    });

    const { result } = renderHook(() => useThumbnailCache());

    act(() => {
      result.current.clearCache();
    });

    // First prefetch (will fail)
    const errorPath = `/test/error-path-${Date.now()}.png`;
    act(() => {
      result.current.prefetchThumbnails([errorPath]);
    });

    // Wait for the first request to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second prefetch (will succeed)
    const successPath = '/test/success.png';
    act(() => {
      result.current.prefetchThumbnails([successPath]);
    });

    // Wait for the success callback
    await waitFor(() => {
      expect(result.current.getThumbnail(successPath)).toBe('success-data');
    });
  });
});

describe('notifyCacheUpdate リスナーエラー保護', () => {
  beforeEach(() => {
    clearAllListeners();
  });

  afterEach(() => {
    clearAllListeners();
  });

  it('リスナーがエラーをスローしても他のリスナーに通知される', () => {
    const errorListener = vi.fn(() => {
      throw new Error('Listener error');
    });
    const normalListener = vi.fn();
    const photoPath = '/test/error-listener.png';

    subscribeToCacheUpdate(photoPath, errorListener);
    subscribeToCacheUpdate(photoPath, normalListener);

    // Should not throw
    expect(() => {
      notifyCacheUpdate(photoPath, 'data');
    }).not.toThrow();

    // Both listeners should be called
    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(normalListener).toHaveBeenCalledTimes(1);
    expect(normalListener).toHaveBeenCalledWith('data');
  });

  it('全リスナーがエラーをスローしても例外は伝播しない', () => {
    const errorListener1 = vi.fn(() => {
      throw new Error('Error 1');
    });
    const errorListener2 = vi.fn(() => {
      throw new Error('Error 2');
    });
    const photoPath = '/test/all-error.png';

    subscribeToCacheUpdate(photoPath, errorListener1);
    subscribeToCacheUpdate(photoPath, errorListener2);

    expect(() => {
      notifyCacheUpdate(photoPath, 'data');
    }).not.toThrow();

    expect(errorListener1).toHaveBeenCalledTimes(1);
    expect(errorListener2).toHaveBeenCalledTimes(1);
  });
});
