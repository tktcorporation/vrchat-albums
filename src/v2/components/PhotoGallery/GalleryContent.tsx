import { useVirtualizer } from '@tanstack/react-virtual';
import { LoaderCircle } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { match } from 'ts-pattern';
import { LAYOUT_CONSTANTS } from '../../constants/layoutConstants';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import type { UseLoadingStateResult } from '../../hooks/useLoadingState';
import { useThumbnailCache } from '../../hooks/useThumbnailCache';
import { isPhotoLoaded } from '../../types/photo';
import type { ValidWidth } from '../../types/validWidth';
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

/**
 * スケルトン行の共通コンポーネント
 */
const SkeletonRow = () => (
  <div className="space-y-2 animate-pulse">
    <div className="h-8 bg-muted rounded-lg w-2/3" />
    <div className="grid grid-cols-4 gap-4">
      <div className="aspect-square bg-muted rounded-lg" />
      <div className="aspect-square bg-muted rounded-lg" />
      <div className="aspect-square bg-muted rounded-lg" />
      <div className="aspect-square bg-muted rounded-lg" />
      <div className="aspect-square bg-muted rounded-lg" />
      <div className="aspect-square bg-muted rounded-lg" />
      <div className="aspect-square bg-muted rounded-lg" />
      <div className="aspect-square bg-muted rounded-lg" />
    </div>
  </div>
);

/**
 * 幅測定中のスケルトン表示
 */
const MeasuringSkeleton = () => (
  <div className="flex-1 p-4 space-y-8">
    <SkeletonRow />
    <SkeletonRow />
    <SkeletonRow />
  </div>
);

/**
 * グルーピング中のスケルトン表示
 */
const GroupingSkeleton = () => (
  <div className="flex-1 overflow-y-auto p-4 space-y-8">
    <SkeletonRow />
    <SkeletonRow />
    <SkeletonRow />
  </div>
);

/**
 * 仮想スクロールギャラリーのプロパティ
 */
interface VirtualizedGalleryProps {
  width: ValidWidth;
  filteredGroups: Array<[string, GroupedPhoto]>;
  groupsArray: GroupedPhoto[];
  selectedPhotos: string[];
  setSelectedPhotos: (
    update: string[] | ((prev: string[]) => string[]),
  ) => void;
  isMultiSelectMode: boolean;
  setIsMultiSelectMode: (value: boolean) => void;
  isLoading: boolean;
  galleryData?: PhotoGalleryData;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 仮想スクロールを使用するギャラリー本体
 *
 * width が ValidWidth 型で保証されているため、レイアウト計算は常に成功する。
 */
const VirtualizedGallery = memo(
  ({
    width,
    filteredGroups,
    groupsArray,
    selectedPhotos,
    setSelectedPhotos,
    isMultiSelectMode,
    setIsMultiSelectMode,
    isLoading,
    galleryData,
    containerRef,
  }: VirtualizedGalleryProps) => {
    const [currentGroupIndex, setCurrentGroupIndex] = useState<
      number | undefined
    >(undefined);
    const observerRef = useRef<IntersectionObserver | null>(null);

    // ValidWidth を number として使用（型は保証済み）
    const widthValue = width as number;
    const widthRef = useRef(widthValue);
    widthRef.current = widthValue;

    // サムネイルキャッシュ（Google Photos風の高速ローディング）
    const { prefetchThumbnails } = useThumbnailCache();

    // レイアウト計算機（再利用のためメモ化）
    const layoutCalculator = useMemo(() => new JustifiedLayoutCalculator(), []);

    // 仮想スクローラーの設定
    const virtualizer = useVirtualizer({
      count: filteredGroups.length,
      getScrollElement: () => containerRef.current,
      estimateSize: useCallback(
        (index) => {
          const [, group] = filteredGroups[index];
          const estimate = estimateGroupHeight(
            group.photos,
            widthRef.current,
            undefined,
            layoutCalculator,
          );
          return estimate.height;
        },
        [filteredGroups, layoutCalculator],
      ),
      overscan: 5,
    });

    // 幅が変更されたら virtualizer に再計算させる
    useEffect(() => {
      virtualizer.measure();
    }, [widthValue, virtualizer]);

    // 日付ジャンプハンドラー
    const handleJumpToDate = useCallback(
      (groupIndex: number) => {
        virtualizer.scrollToIndex(groupIndex, {
          behavior: 'auto',
          align: 'start',
        });

        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(groupIndex, {
            behavior: 'auto',
            align: 'start',
          });
        });
      },
      [virtualizer],
    );

    // 表示中のグループの写真をプリフェッチ
    useEffect(() => {
      const virtualItems = virtualizer.getVirtualItems();
      if (virtualItems.length === 0) return;

      const firstIndex = virtualItems[0].index;
      const lastIndex = virtualItems[virtualItems.length - 1].index;
      const prefetchStart = Math.max(0, firstIndex - 2);
      const prefetchEnd = Math.min(filteredGroups.length, lastIndex + 5);

      const pathsToPrefetch: string[] = [];
      for (let i = prefetchStart; i < prefetchEnd; i++) {
        const [, group] = filteredGroups[i];
        for (const photo of group.photos) {
          if (isPhotoLoaded(photo)) {
            pathsToPrefetch.push(photo.photoPath.value);
          }
        }
      }

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
          rootMargin: '-10% 0px -80% 0px',
          threshold: 0,
        },
      );

      observerRef.current = observer;

      return () => {
        observer.disconnect();
      };
    }, [containerRef]);

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
      [
        containerRef,
        isMultiSelectMode,
        setSelectedPhotos,
        setIsMultiSelectMode,
      ],
    );

    return (
      <>
        <div
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
              const isGroupFullyLoaded =
                group.photos.length > 0 &&
                group.photos.every((photo) => isPhotoLoaded(photo));

              return (
                <div
                  key={key}
                  data-index={virtualRow.index}
                  ref={(el) => {
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
                          effectiveWidth={widthValue}
                          selectedPhotos={selectedPhotos}
                          setSelectedPhotos={setSelectedPhotos}
                          isMultiSelectMode={isMultiSelectMode}
                          setIsMultiSelectMode={setIsMultiSelectMode}
                          onCopySelected={galleryData?.onCopySelected}
                        />
                      </div>
                    </div>
                  ) : (
                    <GroupWithSkeleton
                      photos={group.photos}
                      effectiveWidth={widthValue}
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
            <div className="fixed bottom-4 right-6 flex items-center space-x-2 bg-background/80 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg">
              <LoaderCircle className="w-4 h-4 animate-spin text-muted-foreground" />
              <div className="text-sm text-muted-foreground">読み込み中...</div>
            </div>
          )}
        </div>
        <DateJumpSidebar
          groups={groupsArray}
          onJumpToDate={handleJumpToDate}
          currentGroupIndex={currentGroupIndex}
          scrollContainer={containerRef.current}
        />
      </>
    );
  },
);

VirtualizedGallery.displayName = 'VirtualizedGallery';

/**
 * 写真グリッドを表示するメインコンテンツエリア
 *
 * ## アーキテクチャ設計：動的レイアウトとバーチャルスクロールの協調
 *
 * このコンポーネントは以下のパターンで動作します：
 *
 * 1. **useContainerWidth フック**
 *    - コンテナ幅を測定し、ValidWidth 型で保証
 *    - 測定中（measuring）と準備完了（ready）の状態を区別
 *
 * 2. **条件付きレンダリング**
 *    - 測定中: MeasuringSkeleton を表示
 *    - 準備完了: VirtualizedGallery を表示（width は常に > 0 が保証）
 *
 * ## 型安全性
 *
 * ValidWidth 型により、レイアウト計算コードでの width === 0 のチェックが不要。
 * 型レベルで 0 以下の値が排除される。
 *
 * @see useContainerWidth - 幅測定フック
 * @see ValidWidth - 有効な幅の Branded Type
 */
/**
 * 再現用フラグ: ref を遅延させて Electron 起動時のタイミング問題をシミュレート
 * 本番環境では false にすること
 */
const SIMULATE_DELAYED_REF = true;
const SIMULATE_DELAY_MS = 1000; // 1秒遅延

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

    // VirtualizedGallery の getScrollElement 用 RefObject
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Callback Ref パターンで幅を測定
    const { containerRef: widthCallbackRef, widthState } = useContainerWidth(
      LAYOUT_CONSTANTS.GALLERY_CONTAINER_PADDING,
    );

    // Callback ref と RefObject を統合
    const combinedRef = useCallback(
      (node: HTMLDivElement | null) => {
        scrollContainerRef.current = node;
        widthCallbackRef(node);
      },
      [widthCallbackRef],
    );

    // 再現用: ref を遅延で有効化
    const [containerReady, setContainerReady] = useState(!SIMULATE_DELAYED_REF);

    useEffect(() => {
      if (SIMULATE_DELAYED_REF) {
        console.log(
          '[GalleryContent] 🔧 SIMULATE_DELAYED_REF enabled. Delaying ref by',
          SIMULATE_DELAY_MS,
          'ms',
        );
        const timer = setTimeout(() => {
          console.log('[GalleryContent] ✅ Container ref is now ready');
          setContainerReady(true);
        }, SIMULATE_DELAY_MS);
        return () => clearTimeout(timer);
      }
    }, []);

    // 全てのグループを表示（写真があるグループもないグループも）
    const filteredGroups = useMemo(() => {
      return Object.entries(groupedPhotos);
    }, [groupedPhotos]);

    // DateJumpSidebar用のグループ配列
    const groupsArray = useMemo<GroupedPhoto[]>(() => {
      return filteredGroups.map(([_, group]) => group);
    }, [filteredGroups]);

    const isLoading = isLoadingGrouping || isLoadingStartupSync;

    // グルーピング中はスケルトンを表示
    if (isLoadingGrouping) {
      return <GroupingSkeleton />;
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
        {/* コンテナは常にレンダリング（幅測定のため） */}
        {/* 再現用: containerReady が false の間は ref を設定しない */}
        <div
          ref={containerReady ? combinedRef : undefined}
          className="flex-1 flex flex-col"
        >
          {match(widthState)
            .with({ status: 'measuring' }, () => <MeasuringSkeleton />)
            .with({ status: 'ready' }, ({ width }) => (
              <VirtualizedGallery
                width={width}
                filteredGroups={filteredGroups}
                groupsArray={groupsArray}
                selectedPhotos={selectedPhotos}
                setSelectedPhotos={setSelectedPhotos}
                isMultiSelectMode={isMultiSelectMode}
                setIsMultiSelectMode={setIsMultiSelectMode}
                isLoading={isLoading}
                galleryData={galleryData}
                containerRef={scrollContainerRef}
              />
            ))
            .exhaustive()}
        </div>
      </GalleryErrorBoundary>
    );
  },
);

GalleryContent.displayName = 'GalleryContent';

export default GalleryContent;
