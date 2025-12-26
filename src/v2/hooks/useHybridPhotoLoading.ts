import { useCallback, useMemo, useRef, useState } from 'react';
import { trpcReact } from '@/trpc';

/**
 * 軽量メタデータ型（Phase 1で取得）
 */
interface PhotoMetadata {
  id: string;
  photoTakenAt: Date;
  width: number;
  height: number;
}

/**
 * ハイブリッドローディング設定
 */
interface UseHybridPhotoLoadingOptions {
  /** 一度に取得するphotoPathの最大数 */
  batchSize?: number;
}

/**
 * ハイブリッドローディングフックの戻り値
 */
interface UseHybridPhotoLoadingResult {
  /** 軽量メタデータ一覧（全件） */
  photoMetadata: PhotoMetadata[];
  /** メタデータ読み込み中フラグ */
  isLoadingMetadata: boolean;
  /** 指定IDのphotoPathを取得（キャッシュから、またはバッチリクエスト） */
  getPhotoPath: (id: string) => string | undefined;
  /** 複数IDのphotoPathをプリフェッチ（表示範囲に応じて呼び出す） */
  prefetchPhotoPaths: (ids: string[]) => Promise<void>;
  /** キャッシュ済みのphotoPath数 */
  cachedPathCount: number;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * ハイブリッドローディングフック
 *
 * ## 設計思想
 * 写真10万枚の場合のメモリ使用量:
 * - 従来: ~19.3MB (photoPath が 74%)
 * - ハイブリッド: ~5MB (軽量メタデータのみ) + 表示範囲のphotoPath
 *
 * ## 使用方法
 * 1. photoMetadata を使用して高さ計算・グルーピング
 * 2. 表示範囲のIDに対して prefetchPhotoPaths() を呼び出し
 * 3. getPhotoPath(id) でキャッシュ済みのパスを取得
 *
 * @see docs/memory-optimization.md
 */
export function useHybridPhotoLoading(
  query?: {
    gtPhotoTakenAt?: Date;
    ltPhotoTakenAt?: Date;
    orderByPhotoTakenAt: 'asc' | 'desc';
  },
  options: UseHybridPhotoLoadingOptions = {},
): UseHybridPhotoLoadingResult {
  const { batchSize = DEFAULT_BATCH_SIZE } = options;

  // Phase 1: 軽量メタデータを全件取得
  const { data: metadataRaw, isLoading: isLoadingMetadata } =
    trpcReact.vrchatPhoto.getVrchatPhotoMetadataList.useQuery(query, {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    });

  // photoPath キャッシュ（id -> photoPath）
  const pathCacheRef = useRef<Map<string, string>>(new Map());

  // プリフェッチ中のIDセット（重複リクエスト防止）
  const pendingIdsRef = useRef<Set<string>>(new Set());

  // キャッシュ数をリアクティブに管理（UIの再レンダリングをトリガー）
  const [cachedPathCount, setCachedPathCount] = useState(0);

  // Phase 2: photoPath をバッチ取得
  const utils = trpcReact.useUtils();

  const photoMetadata = useMemo<PhotoMetadata[]>(() => {
    if (!metadataRaw) return [];
    return metadataRaw.map((m) => ({
      id: m.id,
      photoTakenAt: new Date(m.photoTakenAt),
      width: m.width,
      height: m.height,
    }));
  }, [metadataRaw]);

  /**
   * 指定IDのphotoPathを取得
   * キャッシュにあればそれを返す
   */
  const getPhotoPath = useCallback((id: string): string | undefined => {
    return pathCacheRef.current.get(id);
  }, []);

  /**
   * 複数IDのphotoPathをプリフェッチ
   * 表示範囲に応じて呼び出すことで、必要なパスのみを取得
   */
  const prefetchPhotoPaths = useCallback(
    async (ids: string[]) => {
      // キャッシュ済みとペンディング中を除外
      const uncachedIds = ids.filter(
        (id) => !pathCacheRef.current.has(id) && !pendingIdsRef.current.has(id),
      );

      if (uncachedIds.length === 0) return;

      // バッチサイズで分割
      for (let i = 0; i < uncachedIds.length; i += batchSize) {
        const batch = uncachedIds.slice(i, i + batchSize);

        // ペンディングに追加
        for (const id of batch) {
          pendingIdsRef.current.add(id);
        }

        try {
          const result = await utils.vrchatPhoto.getVrchatPhotoPathsByIds.fetch(
            { ids: batch },
          );

          // キャッシュに保存
          for (const { id, photoPath } of result) {
            pathCacheRef.current.set(id, photoPath);
          }

          // キャッシュ数を更新（リアクティブ）
          setCachedPathCount(pathCacheRef.current.size);
        } catch (error) {
          console.error('Failed to prefetch photo paths:', error);
        } finally {
          // ペンディングから削除
          for (const id of batch) {
            pendingIdsRef.current.delete(id);
          }
        }
      }
    },
    [batchSize, utils],
  );

  return {
    photoMetadata,
    isLoadingMetadata,
    getPhotoPath,
    prefetchPhotoPaths,
    cachedPathCount,
  };
}
