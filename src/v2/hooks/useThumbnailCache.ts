import { useCallback, useEffect, useRef, useState } from 'react';
import { trpcReact } from '@/trpc';

/**
 * LRUキャッシュの設定
 */
const CACHE_MAX_SIZE = 500; // 最大キャッシュ数
const PREFETCH_BATCH_SIZE = 20; // プリフェッチのバッチサイズ
const PREFETCH_AHEAD = 50; // 何枚先までプリフェッチするか
const CACHE_CHECK_INTERVAL_MS = 100; // キャッシュ更新チェック間隔

/**
 * LRU (Least Recently Used) キャッシュ
 * 最も最近使われていないアイテムから削除される
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // アクセスされたら最新に移動
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 最も古いアイテムを削除
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// グローバルキャッシュインスタンス（コンポーネント間で共有）
const globalThumbnailCache = new LRUCache<string, string>(CACHE_MAX_SIZE);
const pendingRequests = new Set<string>();

/**
 * サムネイルキャッシュとプリフェッチを管理するフック
 *
 * ## 特徴
 * - LRUキャッシュでメモリ使用量を制限
 * - バッチリクエストでネットワーク効率を改善
 * - 先読みプリフェッチでスムーズなスクロール
 *
 * ## 使用例
 * ```tsx
 * const { getThumbnail, prefetchThumbnails, cacheSize } = useThumbnailCache();
 *
 * // キャッシュからサムネイルを取得
 * const thumbnail = getThumbnail(photoPath);
 *
 * // 表示範囲のサムネイルをプリフェッチ
 * useEffect(() => {
 *   prefetchThumbnails(visiblePhotoPaths);
 * }, [visiblePhotoPaths]);
 * ```
 */
export function useThumbnailCache() {
  const [cacheSize, setCacheSize] = useState(globalThumbnailCache.size);
  const prefetchQueueRef = useRef<string[]>([]);
  const isPrefetchingRef = useRef(false);

  const utils = trpcReact.useUtils();

  /**
   * キャッシュからサムネイルを取得
   */
  const getThumbnail = useCallback((photoPath: string): string | undefined => {
    return globalThumbnailCache.get(photoPath);
  }, []);

  /**
   * サムネイルをキャッシュに保存
   */
  const setThumbnail = useCallback((photoPath: string, data: string) => {
    globalThumbnailCache.set(photoPath, data);
    setCacheSize(globalThumbnailCache.size);
  }, []);

  /**
   * バッチでサムネイルをフェッチ
   */
  const fetchBatch = useCallback(
    async (paths: string[]) => {
      // 既にキャッシュにあるものとペンディング中のものを除外
      const pathsToFetch = paths.filter(
        (path) => !globalThumbnailCache.has(path) && !pendingRequests.has(path),
      );

      if (pathsToFetch.length === 0) return;

      // ペンディングに追加
      for (const path of pathsToFetch) {
        pendingRequests.add(path);
      }

      try {
        const result = await utils.vrchatPhoto.getBatchThumbnails.fetch({
          photoPaths: pathsToFetch.slice(0, PREFETCH_BATCH_SIZE),
          width: 256,
        });

        // キャッシュに保存
        for (const { photoPath, data } of result) {
          globalThumbnailCache.set(photoPath, data);
        }
        setCacheSize(globalThumbnailCache.size);
      } catch (error) {
        console.error('Failed to fetch batch thumbnails:', error);
      } finally {
        // ペンディングから削除
        for (const path of pathsToFetch) {
          pendingRequests.delete(path);
        }
      }
    },
    [utils],
  );

  /**
   * プリフェッチキューを処理
   */
  const processPrefetchQueue = useCallback(async () => {
    if (isPrefetchingRef.current || prefetchQueueRef.current.length === 0) {
      return;
    }

    isPrefetchingRef.current = true;

    try {
      while (prefetchQueueRef.current.length > 0) {
        const batch = prefetchQueueRef.current.splice(0, PREFETCH_BATCH_SIZE);
        await fetchBatch(batch);

        // 次のバッチの前に少し待機（UIをブロックしない）
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      isPrefetchingRef.current = false;
    }
  }, [fetchBatch]);

  /**
   * 複数のサムネイルをプリフェッチ
   * 表示範囲 + 先読み範囲のサムネイルをバッチでフェッチ
   */
  const prefetchThumbnails = useCallback(
    (paths: string[]) => {
      // 既にキャッシュにあるものを除外
      const pathsToQueue = paths.filter(
        (path) => !globalThumbnailCache.has(path) && !pendingRequests.has(path),
      );

      if (pathsToQueue.length === 0) return;

      // キューに追加（重複を避ける）
      const existingInQueue = new Set(prefetchQueueRef.current);
      for (const path of pathsToQueue) {
        if (!existingInQueue.has(path)) {
          prefetchQueueRef.current.push(path);
        }
      }

      // 非同期で処理開始
      processPrefetchQueue();
    },
    [processPrefetchQueue],
  );

  /**
   * 表示中のインデックスに基づいてプリフェッチ
   */
  const prefetchAroundIndex = useCallback(
    (allPaths: string[], currentIndex: number, visibleCount: number) => {
      const start = Math.max(0, currentIndex - visibleCount);
      const end = Math.min(
        allPaths.length,
        currentIndex + visibleCount + PREFETCH_AHEAD,
      );
      const pathsToFetch = allPaths.slice(start, end);
      prefetchThumbnails(pathsToFetch);
    },
    [prefetchThumbnails],
  );

  /**
   * キャッシュをクリア
   */
  const clearCache = useCallback(() => {
    globalThumbnailCache.clear();
    setCacheSize(0);
  }, []);

  return {
    getThumbnail,
    setThumbnail,
    prefetchThumbnails,
    prefetchAroundIndex,
    clearCache,
    cacheSize,
  };
}

/**
 * 個別の写真用フック
 * キャッシュにあればすぐに返し、なければフェッチする
 */
export function useThumbnail(photoPath: string, enabled = true) {
  const { getThumbnail, prefetchThumbnails } = useThumbnailCache();
  const [thumbnail, setThumbnailState] = useState<string | undefined>(() =>
    getThumbnail(photoPath),
  );

  // キャッシュから取得を試みる
  useEffect(() => {
    if (!enabled || !photoPath) return;

    const cached = getThumbnail(photoPath);
    if (cached) {
      setThumbnailState(cached);
      return;
    }

    // キャッシュにない場合はプリフェッチ
    prefetchThumbnails([photoPath]);
  }, [photoPath, enabled, getThumbnail, prefetchThumbnails]);

  // キャッシュが更新されたらチェック
  useEffect(() => {
    if (!enabled || !photoPath) return;

    const interval = setInterval(() => {
      const cached = getThumbnail(photoPath);
      if (cached && cached !== thumbnail) {
        setThumbnailState(cached);
      }
    }, CACHE_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [photoPath, enabled, getThumbnail, thumbnail]);

  return thumbnail;
}
