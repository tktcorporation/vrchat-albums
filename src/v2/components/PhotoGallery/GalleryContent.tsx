import { useVirtualizer } from '@tanstack/react-virtual';
import { LoaderCircle } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAYOUT_CONSTANTS } from '../../constants/layoutConstants';
import type { UseLoadingStateResult } from '../../hooks/useLoadingState';
import { useThumbnailCache } from '../../hooks/useThumbnailCache';
import { isPhotoLoaded } from '../../types/photo';
import { estimateGroupHeight } from '../../utils/estimateGroupHeight';
import { JustifiedLayoutCalculator } from '../../utils/justifiedLayoutCalculator';
import { AppHeader } from '../AppHeader';
import { GroupWithSkeleton } from '../GroupWithSkeleton';
import { LocationGroupHeader } from '../LocationGroupHeader';
import type { PhotoGalleryData } from '../PhotoGallery';
import PhotoGrid from '../PhotoGrid';
import { DateJumpSidebar } from './DateJumpSidebar';
import { GalleryErrorBoundary } from './GalleryErrorBoundary';
import type { GroupedPhoto } from './useGroupPhotos';
import { usePhotoGallery } from './usePhotoGallery';

/**
 * ギャラリーコンテンツコンポーネントのプロパティ定義
 */
interface GalleryContentProps
  extends Pick<
    UseLoadingStateResult,
    'isLoadingStartupSync' | 'isLoadingGrouping' | 'finishLoadingGrouping'
  > {
  /** ヘッダーから渡される検索クエリ */
  searchQuery: string;
  /** 検索タイプ（world | player | undefined） */
  searchType?: 'world' | 'player';
  /** ギャラリーデータ（統合AppHeaderに渡す） */
  galleryData?: PhotoGalleryData;
}

const SkeletonGroup = () => (
  <div className="space-y-2 animate-pulse">
    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-2/3" />
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, _i) => (
        <div
          key={`skeleton-photo-${crypto.randomUUID()}`}
          className="aspect-square bg-gray-200 dark:bg-gray-700 rounded-lg"
        />
      ))}
    </div>
  </div>
);

/**
 * 写真グリッドを表示するメインコンテンツエリア
 * 仮想スクロールを使用して大量の写真を効率的にレンダリングします。
 *
 * ## アーキテクチャ設計：動的レイアウトとバーチャルスクロールの協調
 *
 * このコンポーネントは以下の2つのシステムが密接に連携して動作します：
 *
 * 1. **PhotoGrid の動的幅計算**
 *    - コンテナ幅に基づいて各写真のサイズを動的に計算
 *    - ResizeObserver で幅の変化を検知し、レイアウトを再計算
 *    - 各行の写真を親要素の幅にジャストフィットさせる
 *
 * 2. **Virtualizer の高さ管理**
 *    - estimateSize で事前計算による高さ推定（estimateGroupHeight）
 *    - measureElement で実際のDOM要素の高さを測定・キャッシュ
 *    - キャッシュがある場合は実測値、なければ計算値を使用
 *
 * ## レイアウトシフト対策
 *
 * - **事前計算**: JustifiedLayoutCalculator で高さを事前推定
 * - **overscan**: 画面外のグループを多く保持してスクロールを安定化
 *
 * @see estimateGroupHeight - 高さ推定ロジック
 * @see JustifiedLayoutCalculator - レイアウト計算
 */
const GalleryContent = memo(
  ({
    searchQuery,
    searchType,
    isLoadingStartupSync,
    isLoadingGrouping,
    finishLoadingGrouping,
    galleryData,
  }: GalleryContentProps) => {
    const {
      groupedPhotos,
      selectedPhotos,
      setSelectedPhotos,
      isMultiSelectMode,
      setIsMultiSelectMode,
    } = usePhotoGallery(searchQuery, searchType, {
      onGroupingEnd: finishLoadingGrouping,
    });
    const containerRef = useRef<HTMLDivElement>(null);
    const [currentGroupIndex, setCurrentGroupIndex] = useState<
      number | undefined
    >(undefined);
    const observerRef = useRef<IntersectionObserver | null>(null);

    // サムネイルキャッシュ（Google Photos風の高速ローディング）
    const { prefetchThumbnails } = useThumbnailCache();

    // 全てのグループを表示（写真があるグループもないグループも）
    const filteredGroups = useMemo(() => {
      return Object.entries(groupedPhotos);
    }, [groupedPhotos]);

    // DateJumpSidebar用のグループ配列
    const groupsArray = useMemo<GroupedPhoto[]>(() => {
      return filteredGroups.map(([_, group]) => group);
    }, [filteredGroups]);

    const isLoading = isLoadingGrouping || isLoadingStartupSync;

    // レイアウト計算機（再利用のためメモ化）
    const layoutCalculator = useMemo(() => new JustifiedLayoutCalculator(), []);

    // 仮想スクローラーの設定
    // measureElement を削除し、事前計算のみを使用することで：
    // 1. estimateSize と実測値の差異によるレイアウトシフトを防止
    // 2. 上方向スクロール時の再測定によるジャンプ/スタッターを防止
    const virtualizer = useVirtualizer({
      count: filteredGroups.length,
      getScrollElement: () => containerRef.current,
      estimateSize: useCallback(
        (index) => {
          const [, group] = filteredGroups[index];
          // コンテナ幅を PhotoGrid/GroupWithSkeleton と統一（padding を考慮）
          const rawWidth = containerRef.current?.clientWidth ?? 0;
          const effectiveWidth =
            rawWidth > 0
              ? rawWidth - LAYOUT_CONSTANTS.GALLERY_CONTAINER_PADDING
              : 0;

          // 常に計算値を返す（キャッシュは使わない）
          const estimate = estimateGroupHeight(
            group.photos,
            effectiveWidth,
            undefined, // キャッシュを使用しない
            layoutCalculator,
          );
          return estimate.height;
        },
        [filteredGroups, layoutCalculator],
      ),
      // 画面外のグループを多く保持してスクロール時のレイアウトシフトを軽減
      overscan: 5,
      // measureElement を削除：再測定によるレイアウトシフトと上方向スクロール問題を防止
    });

    // 日付ジャンプハンドラー
    const handleJumpToDate = useCallback(
      (groupIndex: number) => {
        // 即座にジャンプ（アニメーションなし）
        virtualizer.scrollToIndex(groupIndex, {
          behavior: 'auto',
          align: 'start',
        });

        // バーチャルスクロールの更新を強制
        requestAnimationFrame(() => {
          // 再度確実にジャンプ（バーチャルスクロールの測定が完了後）
          virtualizer.scrollToIndex(groupIndex, {
            behavior: 'auto',
            align: 'start',
          });
        });
      },
      [virtualizer],
    );

    // 表示中のグループの写真をプリフェッチ（Google Photos風の先読み）
    useEffect(() => {
      const virtualItems = virtualizer.getVirtualItems();
      if (virtualItems.length === 0) return;

      // 表示中 + 前後のグループのインデックスを計算
      const firstIndex = virtualItems[0].index;
      const lastIndex = virtualItems[virtualItems.length - 1].index;
      const prefetchStart = Math.max(0, firstIndex - 2); // 2グループ前から
      const prefetchEnd = Math.min(filteredGroups.length, lastIndex + 5); // 5グループ先まで

      // プリフェッチ対象の写真パスを収集（完全ロード済みのみ）
      const pathsToPrefetch: string[] = [];
      for (let i = prefetchStart; i < prefetchEnd; i++) {
        const [, group] = filteredGroups[i];
        for (const photo of group.photos) {
          if (isPhotoLoaded(photo)) {
            pathsToPrefetch.push(photo.photoPath.value);
          }
        }
      }

      // バッチでプリフェッチ
      if (pathsToPrefetch.length > 0) {
        prefetchThumbnails(pathsToPrefetch);
      }
    }, [virtualizer, filteredGroups, prefetchThumbnails]);

    // IntersectionObserverでビューポート内のグループを検知
    useEffect(() => {
      if (!containerRef.current) return;

      const observer = new IntersectionObserver(
        (entries) => {
          const visibleEntries = entries.filter(
            (entry) => entry.isIntersecting,
          );
          if (visibleEntries.length > 0) {
            // 最も上にある可視グループを取得
            const topEntry = visibleEntries.reduce((prev, current) => {
              return prev.boundingClientRect.top <
                current.boundingClientRect.top
                ? prev
                : current;
            });
            const index = topEntry.target.getAttribute('data-index');
            if (index !== null) {
              setCurrentGroupIndex(Number.parseInt(index, 10));
            }
          }
        },
        {
          root: containerRef.current,
          rootMargin: '-10% 0px -80% 0px', // 上部10%付近のグループを検知
          threshold: 0,
        },
      );

      observerRef.current = observer;

      return () => {
        observer.disconnect();
      };
    }, []);

    /**
     * 背景（コンテナ自身）がクリックされた場合に写真の選択を解除するハンドラ
     */
    const handleBackgroundClick = useCallback(
      (
        event:
          | React.MouseEvent<HTMLDivElement>
          | React.KeyboardEvent<HTMLDivElement>,
      ) => {
        if (event.target === containerRef.current && isMultiSelectMode) {
          setSelectedPhotos([]);
          setIsMultiSelectMode(false);
        }
      },
      [isMultiSelectMode, setSelectedPhotos, setIsMultiSelectMode],
    );

    if (isLoadingGrouping) {
      return (
        <div className="flex-1 overflow-y-auto p-4 space-y-8">
          {Array.from({ length: 3 }).map((_, _i) => (
            <SkeletonGroup key={`skeleton-group-${crypto.randomUUID()}`} />
          ))}
        </div>
      );
    }

    return (
      <GalleryErrorBoundary>
        {galleryData && (
          <AppHeader
            searchQuery={galleryData.searchQuery}
            setSearchQuery={galleryData.setSearchQuery}
            onOpenSettings={galleryData.onOpenSettings}
            selectedPhotoCount={galleryData.selectedPhotoCount}
            onClearSelection={galleryData.onClearSelection}
            isMultiSelectMode={galleryData.isMultiSelectMode}
            onCopySelected={galleryData.onCopySelected}
            loadingState={galleryData.loadingState}
            showGalleryControls={true}
          />
        )}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-4 pr-4 scrollbar-none"
          onClick={handleBackgroundClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleBackgroundClick(e);
            }
          }}
          role="button"
          tabIndex={-1}
          aria-label="ギャラリー背景"
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const [key, group] = filteredGroups[virtualRow.index];
              // Immich方式: 全写真がロード済みかどうかで表示を切り替え
              // スケルトンと実コンテンツが同じ高さを使用するためレイアウトシフトなし
              const isGroupFullyLoaded =
                group.photos.length > 0 &&
                group.photos.every((photo) => isPhotoLoaded(photo));

              return (
                <div
                  key={key}
                  data-key={key}
                  data-index={virtualRow.index}
                  ref={(el) => {
                    // IntersectionObserver のみ設定（measureElement は不要）
                    if (el) {
                      observerRef.current?.observe(el);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {isGroupFullyLoaded ? (
                    // ロード完了: 実際の写真を表示
                    <div className="w-full space-y-0">
                      <LocationGroupHeader
                        worldId={group.worldInfo?.worldId ?? null}
                        worldName={group.worldInfo?.worldName ?? null}
                        worldInstanceId={
                          group.worldInfo?.worldInstanceId ?? null
                        }
                        photoCount={group.photos.length}
                        joinDateTime={group.joinDateTime}
                      />
                      <div className="w-full rounded-b-lg overflow-hidden">
                        <PhotoGrid
                          photos={group.photos}
                          selectedPhotos={selectedPhotos}
                          setSelectedPhotos={setSelectedPhotos}
                          isMultiSelectMode={isMultiSelectMode}
                          setIsMultiSelectMode={setIsMultiSelectMode}
                          onCopySelected={galleryData?.onCopySelected}
                        />
                      </div>
                    </div>
                  ) : (
                    // ロード中またはphotoなし: GroupWithSkeletonが両方を統一的に処理
                    // photos.length === 0 の場合はヘッダーのみ表示
                    <GroupWithSkeleton
                      photos={group.photos}
                      worldId={group.worldInfo?.worldId ?? null}
                      worldName={group.worldInfo?.worldName ?? null}
                      worldInstanceId={group.worldInfo?.worldInstanceId ?? null}
                      photoCount={group.photos.length}
                      joinDateTime={group.joinDateTime}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {isLoading && (
            <div className="fixed bottom-4 right-6 flex items-center space-x-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg">
              <LoaderCircle className="w-4 h-4 animate-spin text-gray-500" />
              <div className="text-sm text-gray-500">読み込み中...</div>
            </div>
          )}
        </div>
        <DateJumpSidebar
          groups={groupsArray}
          onJumpToDate={handleJumpToDate}
          currentGroupIndex={currentGroupIndex}
          scrollContainer={containerRef.current}
        />
      </GalleryErrorBoundary>
    );
  },
);

GalleryContent.displayName = 'GalleryContent';

export default GalleryContent;
