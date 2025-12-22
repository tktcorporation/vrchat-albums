import { memo, useCallback, useEffect, useState } from 'react';
import { trpcReact } from '@/trpc';
import { useToast } from '../hooks/use-toast';
import { useDebounce } from '../hooks/useDebounce';
import type { UseLoadingStateResult } from '../hooks/useLoadingState';
import { useI18n } from '../i18n/store';
import { useMigrationNotice } from './MigrationNotice';
import GalleryContent from './PhotoGallery/GalleryContent';
import { usePhotoGallery } from './PhotoGallery/usePhotoGallery';
import SettingsModal from './settings/SettingsModal';

interface PhotoGalleryProps extends UseLoadingStateResult {}

export interface PhotoGalleryData {
  searchQuery: string;
  setSearchQuery: (query: string, type?: 'world' | 'player') => void;
  onOpenSettings: () => void;
  selectedPhotoCount: number;
  onClearSelection: () => void;
  isMultiSelectMode: boolean;
  onCopySelected: () => void;
  loadingState: Pick<
    UseLoadingStateResult,
    'isRefreshing' | 'startRefreshing' | 'finishRefreshing'
  >;
}

/**
 * 写真ギャラリーのメインコンポーネント
 * ヘッダー、ギャラリーコンテンツ、設定モーダルを表示します。
 * @param props.startUpStages - アプリ起動時の各処理段階の状態
 */
const PhotoGallery = memo((props: PhotoGalleryProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'world' | 'player' | undefined>(
    undefined,
  );
  const debouncedSearchQuery = useDebounce(searchQuery, 300); // 300ms のデバウンス
  const [showSettings, setShowSettings] = useState(false);
  const { t } = useI18n();
  const { toast } = useToast();
  const { MigrationDialog } = useMigrationNotice();

  const {
    selectedPhotos,
    setSelectedPhotos,
    isMultiSelectMode,
    setIsMultiSelectMode,
    groupedPhotos,
  } = usePhotoGallery(debouncedSearchQuery, searchType, {
    onGroupingEnd: props.finishLoadingGrouping,
  });

  /** 選択をクリアし、複数選択モードを解除するハンドラ */
  const handleClearSelection = () => {
    setSelectedPhotos(new Set());
    setIsMultiSelectMode(false);
  };

  // 複数画像をクリップボードにコピーするミューテーション
  const { mutate: copyMultipleImagesToClipboard } =
    trpcReact.electronUtil.copyMultipleImagePaths.useMutation({
      onSuccess: (_, variables) => {
        const count = variables.length;
        const _isWindows = navigator.platform.includes('Win');

        if (count > 1) {
          toast({
            title: `${count}枚の写真をコピーしました`,
            variant: 'default',
          });
        } else {
          toast({
            title: t('locationHeader.copied'),
            variant: 'default',
          });
        }
      },
      onError: (error) => {
        console.error('Failed to copy multiple images to clipboard:', error);
        toast({
          title: '写真のコピーに失敗しました',
          variant: 'destructive',
        });
      },
    });

  // 選択された写真をクリップボードにコピーするハンドラ
  /** 選択写真のパスを集めて一括コピーする */
  const handleCopySelected = () => {
    if (selectedPhotos.size === 0) {
      return;
    }

    // 選択された写真のパスを取得
    const selectedPhotoUrls: string[] = [];

    // グループ内の写真からIDが一致するものを探す
    for (const group of Object.values(groupedPhotos)) {
      for (const photo of group.photos) {
        if (selectedPhotos.has(photo.id.toString())) {
          selectedPhotoUrls.push(photo.url);
        }
      }
    }

    // 写真をクリップボードにコピー
    if (selectedPhotoUrls.length > 0) {
      copyMultipleImagesToClipboard(selectedPhotoUrls);
    }
  };

  // Esc キーでの選択解除
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isMultiSelectMode) {
        handleClearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMultiSelectMode, handleClearSelection]);

  // 検索ハンドラー（クエリとタイプの両方を更新）
  const handleSearch = useCallback(
    (query: string, type?: 'world' | 'player') => {
      setSearchQuery(query);
      setSearchType(type);
    },
    [],
  );

  // PhotoGalleryData をエクスポートして AppHeader に渡せるようにする
  const galleryData: PhotoGalleryData = {
    searchQuery,
    setSearchQuery: handleSearch,
    onOpenSettings: () => setShowSettings(true),
    selectedPhotoCount: selectedPhotos.size,
    onClearSelection: handleClearSelection,
    isMultiSelectMode,
    onCopySelected: handleCopySelected,
    loadingState: {
      isRefreshing: props.isRefreshing,
      startRefreshing: props.startRefreshing,
      finishRefreshing: props.finishRefreshing,
    },
  };

  return (
    <div className="flex flex-col h-full">
      <MigrationDialog />
      <GalleryContent
        searchQuery={searchQuery}
        searchType={searchType}
        isLoadingStartupSync={props.isLoadingStartupSync}
        isLoadingGrouping={props.isLoadingGrouping}
        finishLoadingGrouping={props.finishLoadingGrouping}
        galleryData={galleryData}
      />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
});

PhotoGallery.displayName = 'PhotoGallery';

export default PhotoGallery;
