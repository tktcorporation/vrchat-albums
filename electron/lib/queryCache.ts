import { err, ok, type Result } from 'neverthrow';
import { logger } from './logger';

export type CacheError = {
  code: 'CACHE_ERROR';
  message: string;
  originalError: unknown;
  cacheKey: string;
  operation: string;
};

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

interface QueryCacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum number of cache entries
  onEvict?: (key: string) => void;
}

/**
 * tRPCレスポンスをキャッシュする簡易クラス。
 *
 * @see docs/log-sync-architecture.md - ログ同期のキャッシュ戦略
 * @see electron/lib/logger.ts - ログ出力
 */
export class QueryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private accessOrder: string[] = [];
  private readonly ttl: number;
  private readonly maxSize: number;
  private readonly onEvict?: (key: string) => void;

  constructor(options: QueryCacheOptions = {}) {
    this.ttl = options.ttl ?? 5 * 60 * 1000; // Default: 5 minutes
    this.maxSize = options.maxSize ?? 100; // Default: 100 entries
    this.onEvict = options.onEvict;
  }

  async getOrFetch<T, E = unknown>(
    key: string,
    fetcher: () => Promise<Result<T, E>>,
    options?: { ttl?: number },
  ): Promise<Result<T, E | CacheError>> {
    try {
      // Check if cached and not expired
      const cached = this.cache.get(key);
      const ttl = options?.ttl ?? this.ttl;

      if (cached && Date.now() - cached.timestamp < ttl) {
        cached.hits++;
        this.updateAccessOrder(key);
        logger.debug(`Cache hit for key: ${key} (hits: ${cached.hits})`);
        return ok(cached.data as T);
      }

      // Remove expired entry
      if (cached) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
      }

      // Fetch new data
      const result = await fetcher();

      if (result.isOk()) {
        this.set(key, result.value);
      }

      return result;
    } catch (error) {
      logger.error({
        message: `Cache error for key "${key}": ${error}`,
        stack: error instanceof Error ? error : new Error(String(error)),
      });
      return err({
        code: 'CACHE_ERROR',
        message: `Cache operation failed for key "${key}": ${error}`,
        originalError: error,
        cacheKey: key,
        operation: 'getOrFetch',
      });
    }
  }

  set<T>(key: string, data: T): void {
    // Evict least recently used if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const lru = this.accessOrder[0];
      if (lru) {
        this.cache.delete(lru);
        this.removeFromAccessOrder(lru);
        this.onEvict?.(lru);
        logger.debug(`Evicted cache entry: ${lru}`);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0,
    });

    this.updateAccessOrder(key);
  }

  invalidate(key: string): void {
    if (this.cache.delete(key)) {
      this.removeFromAccessOrder(key);
      logger.debug(`Invalidated cache entry: ${key}`);
    }
  }

  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.invalidate(key);
        count++;
      }
    }
    logger.debug(
      `Invalidated ${count} cache entries matching pattern: ${pattern}`,
    );
    return count;
  }

  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.accessOrder = [];
    logger.debug(`Cleared ${size} cache entries`);
  }

  getStats(): {
    size: number;
    hitRate: number;
    topKeys: Array<{ key: string; hits: number }>;
  } {
    let totalHits = 0;
    const entries: Array<{ key: string; hits: number }> = [];

    for (const [key, entry] of this.cache.entries()) {
      totalHits += entry.hits;
      entries.push({ key, hits: entry.hits });
    }

    entries.sort((a, b) => b.hits - a.hits);

    return {
      size: this.cache.size,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      topKeys: entries.slice(0, 10),
    };
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }
}

// Global cache instances
export const playerListCache = new QueryCache({
  ttl: 5 * 60 * 1000, // 5 minutes
  maxSize: 50,
  onEvict: (key) => logger.debug(`Player list cache evicted: ${key}`),
});

export const worldInfoCache = new QueryCache({
  ttl: 30 * 60 * 1000, // 30 minutes
  maxSize: 200,
  onEvict: (key) => logger.debug(`World info cache evicted: ${key}`),
});

/**
 * すべてのキャッシュをクリアする
 */
export const clearAllCaches = (): void => {
  playerListCache.clear();
  worldInfoCache.clear();
  logger.debug('All caches cleared');
};

/**
 * 特定のパターンにマッチするキャッシュエントリを無効化
 */
export const invalidateCachePattern = (pattern: RegExp): number => {
  const playerListCount = playerListCache.invalidatePattern(pattern);
  const worldInfoCount = worldInfoCache.invalidatePattern(pattern);
  const totalCount = playerListCount + worldInfoCount;
  logger.debug(
    `Invalidated ${totalCount} cache entries matching pattern: ${pattern}`,
  );
  return totalCount;
};
