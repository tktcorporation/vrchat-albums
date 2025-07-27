import { useVirtualizer } from '@tanstack/react-virtual';
import { LoaderCircle } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseLoadingStateResult } from '../../hooks/useLoadingState';
import { AppHeader } from '../AppHeader';
import { LocationGroupHeader } from '../LocationGroupHeader';
import type { PhotoGalleryData } from '../PhotoGallery';
import PhotoGrid from '../PhotoGrid';
import { DateJumpSidebar } from './DateJumpSidebar';
import { GalleryErrorBoundary } from './GalleryErrorBoundary';
import { MeasurePhotoGroup } from './MeasurePhotoGroup';
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

const GROUP_SPACING = 32;

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
 * このコンポーネントは以下の3つのシステムが密接に連携して動作します：
 *
 * 1. **PhotoGrid の動的幅計算**
 *    - コンテナ幅に基づいて各写真のサイズを動的に計算
 *    - ResizeObserver で幅の変化を検知し、レイアウトを再計算
 *    - 各行の写真を親要素の幅にジャストフィットさせる
 *
 * 2. **MeasurePhotoGroup の予測的高さ計算**
 *    - PhotoGrid と同じアルゴリズムで高さを事前計算
 *    - バーチャルスクロールの初期推定値として使用
 *    - 実際のレンダリング前に大まかな高さを提供
 *
 * 3. **Virtualizer の実測ベース高さ管理**
 *    - measureElement で実際のDOM要素の高さを測定
 *    - groupSizesRef に各グループの実測値を保存
 *    - estimateSize で保存された実測値または予測値を返す
 *
 * ## 重要な同期ポイント
 *
 * - **幅変更時**: PhotoGrid がレイアウトを再計算 → 高さが変化 → Virtualizer が再測定
 * - **初回レンダリング**: MeasurePhotoGroup の予測値 → 実際のレンダリング → 実測値で更新
 * - **スクロール時**: 保存された実測値を使用してスムーズなスクロールを実現
 *
 * @warning これらのシステムが正しく協調しないと、以下の問題が発生します：
 * - セクション間の重なり（高さ計算の不整合）
 * - ガタつくスクロール（推定値と実測値の大きな差）
 * - レイアウトシフト（幅変更時の高さ更新遅延）
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
    const groupSizesRef = useRef<Map<string, number>>(new Map());
    const [currentGroupIndex, setCurrentGroupIndex] = useState<
      number | undefined
    >(undefined);
    const observerRef = useRef<IntersectionObserver | null>(null);

    // 全てのグループを表示（写真があるグループもないグループも）
    const filteredGroups = useMemo(() => {
      return Object.entries(groupedPhotos);
    }, [groupedPhotos]);

    // DateJumpSidebar用のグループ配列
    const groupsArray = useMemo<GroupedPhoto[]>(() => {
      return filteredGroups.map(([_, group]) => group);
    }, [filteredGroups]);

    const isLoading = isLoadingGrouping || isLoadingStartupSync;

    // 仮想スクローラーの設定
    const virtualizer = useVirtualizer({
      count: filteredGroups.length,
      getScrollElement: () => containerRef.current,
      estimateSize: useCallback(
        (index) => {
          const [key] = filteredGroups[index];
          return (groupSizesRef.current.get(key) ?? 0) + GROUP_SPACING;
        },
        [filteredGroups],
      ),
      overscan: 3, // 画面外のデータをより多く保持してスクロール時の再ロードを抑制
      measureElement: useCallback((element: HTMLElement) => {
        const height = element.getBoundingClientRect().height;
        const key = element.getAttribute('data-key');
        if (key) {
          groupSizesRef.current.set(key, height);
        }
        return height + GROUP_SPACING;
      }, []),
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
              setCurrentGroupIndex(Number.parseInt(index));
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
          setSelectedPhotos(new Set());
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
          className="flex-1 overflow-y-auto p-4 pr-4"
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
              return (
                <div
                  key={key}
                  data-key={key}
                  data-index={virtualRow.index}
                  ref={(el) => {
                    if (el) {
                      virtualizer.measureElement(el);
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
                  <div className="w-full space-y-0">
                    <LocationGroupHeader
                      worldId={group.worldInfo?.worldId ?? null}
                      worldName={group.worldInfo?.worldName ?? null}
                      worldInstanceId={group.worldInfo?.worldInstanceId ?? null}
                      photoCount={group.photos.length}
                      joinDateTime={group.joinDateTime}
                    />
                    {group.photos.length > 0 && (
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
                    )}
                  </div>
                  <MeasurePhotoGroup
                    photos={group.photos}
                    onMeasure={(height) => {
                      groupSizesRef.current.set(key, height);
                      virtualizer.measure();
                    }}
                  />
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
