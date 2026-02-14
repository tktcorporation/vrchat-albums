import clsx from 'clsx';
import { Circle } from 'lucide-react';
import React, { memo, useCallback, useRef, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { trpcReact } from '@/trpc';
import { ICON_SIZE } from '../constants/ui';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { useThumbnail } from '../hooks/useThumbnailCache';
import { useI18n } from '../i18n/store';
import { isPhotoLoaded, type Photo } from '../types/photo';
import ProgressiveImage from './ProgressiveImage';

/**
 * PhotoCard コンポーネントのプロパティ定義
 */
interface PhotoCardProps {
  /** 表示する写真オブジェクト */
  photo: Photo;
  /** 画像を優先的に読み込むか (ビューポート内の最初の要素など) */
  priority?: boolean;
  /** 現在選択されている写真のID配列（選択順序を保持） */
  selectedPhotos: string[];
  /** 選択されている写真のID配列を更新する関数 */
  setSelectedPhotos: (
    update: string[] | ((prev: string[]) => string[]),
  ) => void;
  /** このカードが含まれるグリッド全体の写真リスト (複数コピー時のパス取得用、将来的に不要かも) */
  photos: Photo[];
  /** 現在複数選択モードかどうか (ギャラリー全体の状態) */
  isMultiSelectMode: boolean;
  /** 複数選択モードの有効/無効を設定する関数 (ギャラリー全体の状態を更新) */
  setIsMultiSelectMode: (value: boolean) => void;
  /** 計算された表示高さ (オプション) */
  displayHeight?: number;
  /** 選択された写真をコピーする関数（全グループにアクセス可能） */
  onCopySelected?: () => void;
}

/**
 * グリッド内に表示される個々の写真カードコンポーネント。
 * 写真の表示、ホバーエフェクト、選択状態の表示、クリック/右クリックによるインタラクションを担当します。
 */
const PhotoCard: React.FC<PhotoCardProps> = memo(
  ({
    photo,
    priority = false,
    selectedPhotos,
    setSelectedPhotos,
    photos,
    isMultiSelectMode,
    setIsMultiSelectMode,
    displayHeight,
    onCopySelected,
  }) => {
    const { t } = useI18n();
    const elementRef = useRef<HTMLDivElement>(null);
    const [isHovering, setIsHovering] = useState(false);
    // Intersection Observer でビューポート内に入ったか判定
    const isIntersecting = useIntersectionObserver(elementRef, {
      threshold: 0,
      rootMargin: '200px',
    });

    const currentPhotoId = String(photo.id);
    /** このカードが現在選択されているかどうか */
    const isSelected = selectedPhotos.includes(currentPhotoId);
    /** 選択順番（1から始まる、未選択の場合は0） */
    const selectionOrder = selectedPhotos.indexOf(currentPhotoId) + 1;

    /** 画像を読み込むべきか (優先指定またはビューポート内) */
    const shouldLoad = priority || isIntersecting;
    const placeholderUrl = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${photo.width} ${photo.height}'%3E%3Crect width='100%25' height='100%25' fill='%23f3f4f6'/%3E%3C/svg%3E`;

    // ハイブリッドローディング対応: discriminated unionで型安全に判定
    const photoLoaded = isPhotoLoaded(photo);

    // --- サムネイルキャッシュ（Google Photos風の高速ローディング） ---
    // LRUキャッシュを使用してメモリ効率良くサムネイルを管理
    const cachedThumbnail = useThumbnail(
      photoLoaded ? photo.photoPath.value : '',
      shouldLoad && photoLoaded,
    );

    // --- tRPC Hooks ---
    const validatePhotoPathMutation =
      trpcReact.vrchatPhoto.validateVRChatPhotoPath.useMutation();

    // フォールバック: キャッシュにない場合は従来のtRPCクエリを使用
    const { data: photoData } =
      trpcReact.vrchatPhoto.getVRChatPhotoItemData.useQuery(
        photoLoaded ? photo.photoPath.value : '',
        {
          enabled: shouldLoad && photoLoaded && !cachedThumbnail,
          staleTime: 1000 * 60 * 5, // 5分間は再取得しない
        },
      );

    // 最終的に表示するサムネイル（キャッシュ優先）
    const thumbnailSrc = cachedThumbnail || photoData?.data || '';

    // Handle missing photo validation
    React.useEffect(() => {
      if (photoData?.error === 'InputFileIsMissing' && photoLoaded) {
        validatePhotoPathMutation.mutate(photo.photoPath.value);
      }
    }, [photoData, photoLoaded, photo, validatePhotoPathMutation]);
    const copySingleMutation =
      trpcReact.electronUtil.copySingleImagePath.useMutation();
    const copyMultipleMutation =
      trpcReact.electronUtil.copyMultipleImagePaths.useMutation();
    const openInPhotoAppMutation =
      trpcReact.electronUtil.openPhotoPathWithPhotoApp.useMutation();
    const openDirOnExplorerMutation = trpcReact.openDirOnExplorer.useMutation();

    // --- Event Handlers ---

    /** コンテキストメニュー: 写真パスコピー (単一/複数対応) */
    const handleCopyPhotoData = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (selectedPhotos.length > 1 && onCopySelected) {
        // 複数選択時は親コンポーネントのコピー機能を使用（全グループにアクセス可能）
        onCopySelected();
      } else if (selectedPhotos.length > 1) {
        // フォールバック：同じグループ内の写真のみコピー（後方互換性のため）
        // 選択順序を維持してコピー
        const pathsToCopy = selectedPhotos
          .map((id) => {
            const p = photos.find((p) => String(p.id) === id);
            return p && isPhotoLoaded(p) ? p.photoPath.value : undefined;
          })
          .filter((path): path is string => path !== undefined);
        console.log('Triggering multiple photo copy:', pathsToCopy);
        copyMultipleMutation.mutate(pathsToCopy);
      } else if (photoLoaded) {
        copySingleMutation.mutate(photo.photoPath.value);
      }
    };

    /** コンテキストメニュー: 写真アプリで開く */
    const handleOpenInPhotoApp = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (photoLoaded) {
        openInPhotoAppMutation.mutate(photo.photoPath.value);
      }
    };

    /** コンテキストメニュー: フォルダで表示 */
    const handleOpenInExplorer = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (photoLoaded) {
        openDirOnExplorerMutation.mutate(photo.photoPath.value);
      }
    };

    /** カード本体のクリックハンドラ */
    const handleClick = useCallback(() => {
      if (isMultiSelectMode) {
        // 複数選択モード中: 選択/選択解除（順序を保持）
        setSelectedPhotos((prev) => {
          const index = prev.indexOf(currentPhotoId);
          if (index !== -1) {
            // 既に選択されている場合は削除
            return prev.filter((id) => id !== currentPhotoId);
          }
          // 選択されていない場合は末尾に追加
          return [...prev, currentPhotoId];
        });
      } else if (photoLoaded) {
        // 通常モード中: システムの写真ビューアで開く
        openInPhotoAppMutation.mutate(photo.photoPath.value);
      }
    }, [
      isMultiSelectMode,
      currentPhotoId,
      setSelectedPhotos,
      photoLoaded,
      photo,
      openInPhotoAppMutation,
    ]);

    /** 左上の選択アイコンのクリックハンドラ */
    const handleSelectIconClick = useCallback(
      (e: React.MouseEvent | React.KeyboardEvent) => {
        e.stopPropagation();

        if (!isMultiSelectMode) {
          setIsMultiSelectMode(true);
        }

        setSelectedPhotos((prev) => {
          const index = prev.indexOf(currentPhotoId);
          if (index !== -1) {
            // 既に選択されている場合は削除
            return prev.filter((id) => id !== currentPhotoId);
          }
          // 選択されていない場合は末尾に追加
          return [...prev, currentPhotoId];
        });
      },
      [
        isMultiSelectMode,
        setIsMultiSelectMode,
        currentPhotoId,
        setSelectedPhotos,
      ],
    );

    /** コンテキストメニュー項目共通のアクションラッパー */
    const handleMenuAction = (
      e: React.MouseEvent,
      handler: (e: React.MouseEvent) => void,
    ) => {
      e.stopPropagation();
      handler(e);
    };

    // --- Render ---
    return (
      <div
        ref={elementRef}
        className={clsx(
          'photo-card group relative overflow-hidden transition-all duration-150',
          'cursor-pointer flex items-center justify-center',
          isSelected ? 'bg-muted' : 'bg-muted/60',
          !isMultiSelectMode && 'hover:brightness-105 hover:shadow-sm',
        )}
        style={{
          height: displayHeight ? `${displayHeight}px` : undefined,
          width: '100%',
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClick();
          }
        }}
        role="button"
        tabIndex={0}
        aria-selected={isSelected}
      >
        <ContextMenu>
          <ContextMenuTrigger className="absolute inset-0">
            <div
              className={clsx(
                'absolute top-2 left-2 z-10 rounded-full transition-opacity duration-150',
                isMultiSelectMode || isHovering || isSelected
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100',
              )}
              onClick={handleSelectIconClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleSelectIconClick(e);
                }
              }}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={t('common.contextMenu.copyPhotoData')}
              tabIndex={0}
            >
              {isSelected ? (
                <div
                  className="flex items-center justify-center bg-primary text-primary-foreground rounded-full shadow-sm font-semibold"
                  style={{
                    width: ICON_SIZE.photo.pixels,
                    height: ICON_SIZE.photo.pixels,
                    fontSize: ICON_SIZE.photo.pixels * 0.55,
                  }}
                >
                  {selectionOrder}
                </div>
              ) : (
                <Circle
                  size={ICON_SIZE.photo.pixels}
                  className="text-white/90 bg-gray-900/40 backdrop-blur-sm rounded-full hover:bg-gray-900/60 transition-colors duration-150"
                  strokeWidth={2}
                />
              )}
            </div>

            <div
              className={clsx(
                'absolute inset-0 transition-all duration-150',
                isSelected ? 'p-4' : 'p-0',
              )}
            >
              <div
                className={clsx(
                  'relative w-full h-full overflow-hidden',
                  isSelected ? 'rounded-sm' : '',
                )}
              >
                {shouldLoad ? (
                  <ProgressiveImage
                    src={thumbnailSrc}
                    placeholderSrc={placeholderUrl}
                    alt={
                      photoLoaded
                        ? photo.fileNameWithExt.value
                        : `Photo ${photo.id}`
                    }
                    className="absolute inset-0 w-full h-full object-cover"
                    loading={priority ? 'eager' : 'lazy'}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                ) : (
                  <div
                    className="absolute inset-0 bg-muted animate-pulse"
                    style={{ aspectRatio: `${photo.width / photo.height}` }}
                  />
                )}
              </div>
            </div>

            {!isMultiSelectMode && photoLoaded && (
              <div
                className={clsx(
                  'absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent',
                  'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
                )}
              >
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <h3 className="text-white font-medium truncate text-xs drop-shadow-sm">
                    {photo.fileNameWithExt.value}
                  </h3>
                </div>
              </div>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent onClick={(e) => e.stopPropagation()}>
            <ContextMenuItem
              onClick={(e) => handleMenuAction(e, handleCopyPhotoData)}
              disabled={!photoLoaded}
            >
              {selectedPhotos.length > 1
                ? `${selectedPhotos.length}枚の写真をコピー`
                : t('common.contextMenu.copyPhotoData')}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={(e) => handleMenuAction(e, handleOpenInPhotoApp)}
            >
              {t('common.contextMenu.openInPhotoApp')}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={(e) => handleMenuAction(e, handleOpenInExplorer)}
            >
              {t('common.contextMenu.showInExplorer')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  },
);

PhotoCard.displayName = 'PhotoCard';

export default PhotoCard;
