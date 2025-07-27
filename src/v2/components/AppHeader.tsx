import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Copy,
  Download,
  Minus,
  RefreshCw,
  Search,
  Settings,
  Square,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { trpcReact as trpc } from '../../trpc';
import { ICON_SIZE } from '../constants/ui';
import type { UseLoadingStateResult } from '../hooks/useLoadingState';
import { LOG_SYNC_MODE, useLogSync } from '../hooks/useLogSync';
import { useI18n } from '../i18n/store';
import SearchCombobox from './SearchCombobox';

interface AppHeaderProps {
  searchQuery?: string;
  setSearchQuery?: (query: string, type?: 'world' | 'player') => void;
  onOpenSettings?: () => void;
  selectedPhotoCount?: number;
  onClearSelection?: () => void;
  isMultiSelectMode?: boolean;
  onCopySelected?: () => void;
  loadingState?: Pick<
    UseLoadingStateResult,
    'isRefreshing' | 'startRefreshing' | 'finishRefreshing'
  >;
  showGalleryControls?: boolean;
}

/**
 * ウィンドウ操作ボタン、検索機能、ギャラリー操作を統合したアプリヘッダー。
 * スペース効率を重視した統合設計。
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  searchQuery = '',
  setSearchQuery,
  onOpenSettings,
  selectedPhotoCount = 0,
  onClearSelection,
  isMultiSelectMode = false,
  onCopySelected,
  loadingState,
  showGalleryControls = false,
}) => {
  const { t } = useI18n();
  const [updateDownloaded, setUpdateDownloaded] = useState(false);

  const { data: updateStatus } = trpc.updater.getUpdateStatus.useQuery(
    undefined,
    {
      refetchInterval: 1000 * 60 * 60 * 24 * 2,
    },
  );

  const checkForUpdates = trpc.updater.checkForUpdates.useMutation();
  const quitAndInstall = trpc.updater.quitAndInstall.useMutation();

  const { sync: syncLogs, isLoading: isSyncing } = useLogSync({
    onSuccess: () => {
      loadingState?.finishRefreshing();
    },
    onError: (error) => {
      console.error('Failed to sync logs:', error);
      loadingState?.finishRefreshing();
    },
  });

  useEffect(() => {
    if (updateStatus) {
      setUpdateDownloaded(updateStatus.updateDownloaded);
    }
  }, [updateStatus]);

  useEffect(() => {
    checkForUpdates.mutate();
  }, []);

  /** ウィンドウを最小化する */
  const handleMinimize = () => {
    window.Main?.Minimize();
  };

  /** ウィンドウを最大化する */
  const handleMaximize = () => {
    window.Main?.Maximize();
  };

  /** アプリケーションを終了する */
  const handleClose = () => {
    window.Main?.Close();
  };

  /** ログ同期をトリガーしてギャラリーを更新する */
  const handleRefresh = async () => {
    if (!loadingState || loadingState.isRefreshing || isSyncing) {
      return;
    }
    loadingState.startRefreshing();
    await syncLogs(LOG_SYNC_MODE.INCREMENTAL);
  };

  return (
    <div
      className="flex h-11 items-center justify-between px-2 select-none border-b dark:border-gray-700"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleMaximize}
    >
      {/* 左側: ギャラリーコントロール */}
      <div
        className="flex items-center gap-1 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {showGalleryControls && (
          <>
            {isMultiSelectMode ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearSelection}
                  className="h-7 w-7 p-0"
                >
                  <X className={ICON_SIZE.sm.class} />
                </Button>
                <span className="text-xs font-medium px-2">
                  {selectedPhotoCount}件
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCopySelected}
                  disabled={!onCopySelected}
                  className="h-7 w-7 p-0"
                  title={t('common.contextMenu.copyPhotoData')}
                >
                  <Copy className={ICON_SIZE.sm.class} />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenSettings}
                  className="h-7 w-7 p-0"
                >
                  <Settings className={ICON_SIZE.sm.class} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={loadingState?.isRefreshing || isSyncing}
                  className="h-7 w-7 p-0"
                  title={t('common.refresh')}
                >
                  <RefreshCw
                    className={`${ICON_SIZE.sm.class} ${
                      loadingState?.isRefreshing ? 'animate-spin' : ''
                    }`}
                  />
                </Button>
              </>
            )}
          </>
        )}
      </div>

      {/* 中央: 検索バー */}
      {showGalleryControls && setSearchQuery && (
        <div
          className="flex-1 min-w-0 max-w-md mx-4"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <SearchCombobox searchQuery={searchQuery} onSearch={setSearchQuery} />
        </div>
      )}

      {/* 右側: ウィンドウ操作ボタン */}
      <div
        className="flex gap-1 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {updateDownloaded && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => quitAndInstall.mutate()}
            className="h-7 w-7 p-0 hover:bg-green-500/15 text-green-500/70 hover:text-green-500 transition-colors duration-150"
            title="アップデートをインストール"
          >
            <Download className={ICON_SIZE.sm.class} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMinimize}
          className="h-7 w-7 p-0 hover:bg-muted/40 text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-150"
        >
          <Minus className={ICON_SIZE.sm.class} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMaximize}
          className="h-7 w-7 p-0 hover:bg-muted/40 text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-150"
        >
          <Square className={ICON_SIZE.sm.class} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-7 w-7 p-0 hover:bg-red-500/80 text-muted-foreground/60 hover:text-white transition-colors duration-150"
        >
          <X className={ICON_SIZE.sm.class} />
        </Button>
      </div>
    </div>
  );
};
