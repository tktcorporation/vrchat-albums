import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { trpcReact } from '@/trpc';
import clsx from 'clsx';
import { CheckCircle2, Circle } from 'lucide-react';
import pathe from 'pathe';
import type React from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { P, match } from 'ts-pattern';
import { ICON_SIZE } from '../constants/ui';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { useI18n } from '../i18n/store';
import type { Photo } from '../types/photo';
import { generatePreviewPng } from '../utils/previewGenerator';
import ProgressiveImage from './ProgressiveImage';

/**
 * PhotoCard コンポーネントのプロパティ定義
 */
interface PhotoCardProps {
  /** 表示する写真オブジェクト */
  photo: Photo;
  /** 画像を優先的に読み込むか (ビューポート内の最初の要素など) */
  priority?: boolean;
  /** 現在選択されている写真のIDセット */
  selectedPhotos: Set<string>;
  /** 選択されている写真のIDセットを更新する関数 */
  setSelectedPhotos: (
    update: Set<string> | ((prev: Set<string>) => Set<string>),
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
    const isSelected = selectedPhotos.has(currentPhotoId);

    /** 画像を読み込むべきか (優先指定またはビューポート内) */
    const shouldLoad = priority || isIntersecting;
    const placeholderUrl = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${photo.width} ${photo.height}'%3E%3Crect width='100%25' height='100%25' fill='%23f3f4f6'/%3E%3C/svg%3E`;

    // --- tRPC Hooks ---
    const validatePhotoPathMutation =
      trpcReact.vrchatPhoto.validateVRChatPhotoPath.useMutation();
    const { data: photoData } =
      trpcReact.vrchatPhoto.getVRChatPhotoItemData.useQuery(photo.url, {
        enabled: shouldLoad,
        onSuccess: (result) => {
          if (result.error === 'InputFileIsMissing') {
            validatePhotoPathMutation.mutate(photo.url);
          }
        },
      });
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
      if (selectedPhotos.size > 1 && onCopySelected) {
        // 複数選択時は親コンポーネントのコピー機能を使用（全グループにアクセス可能）
        onCopySelected();
      } else if (selectedPhotos.size > 1) {
        // フォールバック：同じグループ内の写真のみコピー（後方互換性のため）
        const pathsToCopy = Array.from(selectedPhotos)
          .map((id) => {
            const p = photos.find((p) => String(p.id) === id);
            return p?.url;
          })
          .filter(Boolean) as string[];
        console.log('Triggering multiple photo copy:', pathsToCopy);
        copyMultipleMutation.mutate(pathsToCopy);
      } else {
        copySingleMutation.mutate(photo.url);
      }
    };

    /** コンテキストメニュー: 写真アプリで開く */
    const handleOpenInPhotoApp = (e: React.MouseEvent) => {
      e.stopPropagation();
      openInPhotoAppMutation.mutate(photo.url);
    };

    /** コンテキストメニュー: フォルダで表示 */
    const handleOpenInExplorer = (e: React.MouseEvent) => {
      e.stopPropagation();
      openDirOnExplorerMutation.mutate(photo.url);
    };

    /** カード本体のクリックハンドラ */
    const handleClick = useCallback(() => {
      if (isMultiSelectMode) {
        // 複数選択モード中: 選択/選択解除
        setSelectedPhotos((prev) => {
          const newSelected = new Set(prev);
          if (newSelected.has(currentPhotoId)) {
            newSelected.delete(currentPhotoId);
          } else {
            newSelected.add(currentPhotoId);
          }
          return newSelected;
        });
      } else {
        // 通常モード中: システムの写真ビューアで開く
        openInPhotoAppMutation.mutate(photo.url);
      }
    }, [
      isMultiSelectMode,
      currentPhotoId,
      setSelectedPhotos,
      photo.url,
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
          const newSelected = new Set(prev);
          if (newSelected.has(currentPhotoId)) {
            newSelected.delete(currentPhotoId);
          } else {
            newSelected.add(currentPhotoId);
          }
          return newSelected;
        });
      },
      [
        isMultiSelectMode,
        setIsMultiSelectMode,
        currentPhotoId,
        setSelectedPhotos,
      ],
    );

    /** カードの右クリックハンドラ */
    const handleContextMenu = useCallback(() => {
      if (!isMultiSelectMode || !selectedPhotos.has(currentPhotoId)) {
        // モード外 or 未選択写真を右クリック: これを選択しモード開始
        setSelectedPhotos(new Set([currentPhotoId]));
        setIsMultiSelectMode(true);
      }
    }, [
      isMultiSelectMode,
      setIsMultiSelectMode,
      currentPhotoId,
      selectedPhotos,
      setSelectedPhotos,
    ]);

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
          isSelected
            ? 'bg-gray-200 dark:bg-gray-700'
            : 'bg-gray-100 dark:bg-gray-800',
          !isMultiSelectMode && 'hover:brightness-105 hover:shadow-sm',
        )}
        style={{
          height: displayHeight ? `${displayHeight}px` : undefined,
          width: '100%',
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
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
                <CheckCircle2
                  size={ICON_SIZE.photo.pixels}
                  className="text-primary bg-white dark:bg-gray-800 rounded-full shadow-sm"
                  strokeWidth={2.5}
                />
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
                    src={photoData?.data || ''}
                    placeholderSrc={placeholderUrl}
                    alt={photo.fileNameWithExt.value}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading={priority ? 'eager' : 'lazy'}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                ) : (
                  <div
                    className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse"
                    style={{ aspectRatio: `${photo.width / photo.height}` }}
                  />
                )}
              </div>
            </div>

            {!isMultiSelectMode && (
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
              disabled={selectedPhotos.size === 0 && !isSelected}
            >
              {selectedPhotos.size > 1
                ? `${selectedPhotos.size}枚の写真をコピー`
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
