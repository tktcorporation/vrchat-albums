import { TRPCClientError } from '@trpc/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { match, P } from 'ts-pattern';
import { trpcReact } from '@/trpc';
import { logger } from '../lib/logger';
import {
  notifyCacheUpdate,
  subscribeToCacheUpdate,
} from '../services/thumbnailEventEmitter';

/**
 * LRUキャッシュの設定
 */
const CACHE_MAX_SIZE = 500; // 最大キャッシュ数
const PREFETCH_BATCH_SIZE = 20; // プリフェッチのバッチサイズ
const PREFETCH_AHEAD = 50; // 何枚先までプリフェッチするか

/**
 * サムネイルキャッシュフックのオプション
 */
export interface UseThumbnailCacheOptions {
  /** バッチフェッチ失敗時のコールバック */
  onFetchError?: (error: unknown, failedPaths: string[]) => void;
}

/**
 * LRU (Least Recently Used) キャッシュ
 *
 * 最も最近使われていないアイテムから削除されるキャッシュ実装。
 * サムネイルデータをメモリ上に保持し、頻繁にアクセスされる
 * 写真のサムネイルを効率的に再利用する。
 *
 * ## LRU動作原理
 * JavaScript の Map は挿入順序を保持する（ES2015+）。
 * - get() 時: 既存エントリを削除→再挿入することで「最新」に移動
 * - set() 時: maxSize超過なら最古（先頭）を削除、新規は末尾に追加
 *
 * ## メモリ管理
 * maxSize を超えるとLRUポリシーで自動的に退避される。
 * 頻繁にアクセスされるサムネイルは常にキャッシュに残り、
 * スクロールで離れた領域のサムネイルから順に退避される。
 *
 * @template K キーの型（通常は photoPath: string）
 * @template V 値の型（通常は base64エンコードされたサムネイル: string）
 *
 * @example
 * ```ts
 * const cache = new LRUCache<string, string>(100);
 * cache.set('/photo/1.png', 'data:image/webp;base64,...');
 * const thumbnail = cache.get('/photo/1.png'); // 取得 & 最新に移動
 * ```
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  /**
   * キャッシュから値を取得
   * アクセスされたエントリは「最新」に移動される（LRU更新）
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Map の挿入順序を利用: 削除→再挿入で末尾（最新）に移動
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * キャッシュに値を設定
   * maxSize を超える場合、最古のエントリを削除してから追加
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // 既存キーの場合は削除してから追加（順序を最新に更新）
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // maxSize超過時: Map.keys().next() は最古（最初に挿入された）キーを返す
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * キーが存在するか確認（LRU順序は変更しない）
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * 現在のキャッシュサイズ
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * キャッシュを完全にクリア
   */
  clear(): void {
    this.cache.clear();
  }
}

// グローバルキャッシュインスタンス（コンポーネント間で共有）
const globalThumbnailCache = new LRUCache<string, string>(CACHE_MAX_SIZE);
const pendingRequests = new Set<string>();

/**
 * テスト用: 小さいmaxSizeでLRUCacheインスタンスを作成
 * @internal テスト専用 - プロダクションコードでは使用しない
 */
export function createLRUCacheForTesting<K, V>(
  maxSize: number,
): {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  has: (key: K) => boolean;
  size: number;
  clear: () => void;
} {
  return new LRUCache<K, V>(maxSize);
}

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
export function useThumbnailCache(options: UseThumbnailCacheOptions = {}) {
  const { onFetchError } = options;
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

      const batchToFetch = pathsToFetch.slice(0, PREFETCH_BATCH_SIZE);
      try {
        const result = await utils.vrchatPhoto.getBatchThumbnails.fetch({
          photoPaths: batchToFetch,
          width: 256,
        });

        // キャッシュに保存 + イベント通知
        for (const { photoPath, data } of result) {
          globalThumbnailCache.set(photoPath, data);
          notifyCacheUpdate(photoPath, data);
        }
        setCacheSize(globalThumbnailCache.size);
      } catch (error) {
        // エラー分類とログ出力
        match(error)
          .with(P.instanceOf(TRPCClientError), (trpcError) => {
            // tRPCエラー（サーバー応答あり）
            logger.warn({
              message: 'tRPC error fetching batch thumbnails',
              error: trpcError,
              details: {
                batchSize: batchToFetch.length,
                code: trpcError.data?.code,
              },
            });
          })
          .otherwise((e) => {
            // ネットワークエラーなど予期しないエラー
            logger.error({
              message: 'Failed to fetch batch thumbnails',
              error: e,
              details: { batchSize: batchToFetch.length },
            });
          });
        // コールバックがあれば通知（UIへの表示等）
        onFetchError?.(error, batchToFetch);
      } finally {
        // ペンディングから削除
        for (const path of pathsToFetch) {
          pendingRequests.delete(path);
        }
      }
    },
    [utils, onFetchError],
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

  // キャッシュ更新イベントを購読
  useEffect(() => {
    if (!enabled || !photoPath) return;

    // 既にキャッシュにある場合は購読不要
    const cached = getThumbnail(photoPath);
    if (cached) return;

    // キャッシュ更新を待つ
    return subscribeToCacheUpdate(photoPath, setThumbnailState);
  }, [photoPath, enabled, getThumbnail]);

  return thumbnail;
}
