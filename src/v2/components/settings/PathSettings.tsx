import { FolderOpen, Plus, RefreshCw, Trash } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { match } from 'ts-pattern';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpcReact } from '@/trpc';
import {
  SPACING,
  SURFACE_COLOR,
  TEXT_COLOR,
  TYPOGRAPHY,
} from '../../constants/ui';
import { LOG_SYNC_MODE, useLogSync } from '../../hooks/useLogSync';
import { useVRChatPhotoExtraDirList } from '../../hooks/useVRChatPhotoExtraDirList';
import { useI18n } from '../../i18n/store';
import { SettingsPathInput, SettingsSection } from './common';

interface PathSettingsProps {
  showRefreshAll: boolean;
}

/**
 * VRChat のログ・写真フォルダを設定する画面。
 * データソース変更時のリフレッシュ処理もここから行われる。
 */
const PathSettingsComponent = memo(({ showRefreshAll }: PathSettingsProps) => {
  const { t } = useI18n();

  // ログ同期フックを使用
  const { sync: syncLogs, isLoading: isRefreshing } = useLogSync({
    onSuccess: () => {
      console.log('Log sync completed successfully');
    },
    onError: (error) => {
      console.error('Failed to sync logs:', error);
    },
  });

  // Photo directory queries and mutations
  const { data: photoDir, refetch: refetchPhotoDir } =
    trpcReact.vrchatPhoto.getVRChatPhotoDirPath.useQuery();
  const setPhotoDirectoryMutation =
    trpcReact.vrchatPhoto.setVRChatPhotoDirPathToSettingStore.useMutation();
  const setPhotoPathDirectlyMutation =
    trpcReact.vrchatPhoto.setVRChatPhotoDirPathDirectly.useMutation();

  const [extraDirs, setExtraDirs] = useVRChatPhotoExtraDirList();
  const showOpenDialogMutation = trpcReact.showOpenDialog.useMutation();

  // Log file queries and mutations
  const { data: logFilesDir, refetch: refetchLogFilesDir } =
    trpcReact.getVRChatLogFilesDir.useQuery();
  const setLogPathMutation =
    trpcReact.setVRChatLogFilesDirByDialog.useMutation();
  const setLogPathDirectlyMutation =
    trpcReact.setVRChatLogFilePath.useMutation();

  const [logInputValue, setLogInputValue] = useState('');
  const [isLogPathManuallyChanged, setIsLogPathManuallyChanged] =
    useState(false);

  const [photoInputValue, setPhotoInputValue] = useState('');
  const [isPhotoPathManuallyChanged, setIsPhotoPathManuallyChanged] =
    useState(false);

  useEffect(() => {
    if (logFilesDir?.path) {
      setLogInputValue(logFilesDir.path);
    } else {
      setLogInputValue('');
    }
    setIsLogPathManuallyChanged(false);
  }, [logFilesDir?.path]);

  useEffect(() => {
    if (photoDir?.value) {
      setPhotoInputValue(photoDir.value);
    } else {
      setPhotoInputValue('');
    }
    setIsPhotoPathManuallyChanged(false);
  }, [photoDir?.value]);

  const [photoValidationResult, _setPhotoValidationResult] = useState<
    'MODEL_NOT_FOUND' | 'FILE_NOT_FOUND_MODEL_DELETED' | 'VALID' | null
  >(null);

  const handleBrowsePhotoDirectory = async () => {
    try {
      const result = await setPhotoDirectoryMutation.mutateAsync();
      if (result) {
        await refetchPhotoDir();
      }
    } catch (error) {
      console.error('Failed to browse photo directory:', error);
    }
  };

  const handleBrowseLogFile = async () => {
    try {
      const result = await setLogPathMutation.mutateAsync();
      if (result) {
        await refetchLogFilesDir();
        setIsLogPathManuallyChanged(false);
      }
    } catch (error) {
      console.error('Failed to browse log file:', error);
    }
  };

  const handleLogInputChange = (value: string) => {
    setLogInputValue(value);
    setIsLogPathManuallyChanged(value !== (logFilesDir?.path || ''));
  };

  const handleLogPathSave = async () => {
    try {
      await setLogPathDirectlyMutation.mutateAsync(logInputValue, {
        onSuccess: async () => {
          await refetchLogFilesDir();
          setIsLogPathManuallyChanged(false);
        },
        onError: (error) => {
          console.error('Failed to save log path:', error);
        },
      });
    } catch (error) {
      console.error('Failed to save log path:', error);
    }
  };

  const handlePhotoInputChange = (value: string) => {
    setPhotoInputValue(value);
    setIsPhotoPathManuallyChanged(value !== (photoDir?.value || ''));
  };

  const handlePhotoPathSave = async () => {
    try {
      await setPhotoPathDirectlyMutation.mutateAsync(photoInputValue, {
        onSuccess: async () => {
          await refetchPhotoDir();
          setIsPhotoPathManuallyChanged(false);
        },
        onError: (error) => {
          console.error('Failed to save photo path:', error);
        },
      });
    } catch (error) {
      console.error('Failed to save photo path:', error);
    }
  };

  const handleRefreshAll = async () => {
    if (!isRefreshing) {
      await syncLogs(LOG_SYNC_MODE.FULL);
    }
  };

  const handleBrowseExtraDirectory = async () => {
    const result = await showOpenDialogMutation.mutateAsync({
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setExtraDirs([...extraDirs, result.filePaths[0]]);
    }
  };

  const handleRemoveExtraDirectory = (index: number) => {
    const newDirs = [...extraDirs];
    newDirs.splice(index, 1);
    setExtraDirs(newDirs);
  };

  // 写真ディレクトリのバリデーションエラーメッセージ
  const photoValidationErrorMessage = match(photoValidationResult)
    .with('MODEL_NOT_FOUND', () => '写真ディレクトリのモデルが見つかりません')
    .with(
      'FILE_NOT_FOUND_MODEL_DELETED',
      () => '写真ディレクトリが存在しないため、モデルを削除しました',
    )
    .with('VALID', () => null)
    .with(null, () => null)
    .exhaustive();

  // ログファイルのバリデーションエラーメッセージ
  const logValidationErrorMessage = match(logFilesDir?.error ?? null)
    .with('logFilesNotFound', () => 'ログファイルが見つかりませんでした')
    .with('logFileDirNotFound', () => 'フォルダの読み取りに失敗しました')
    .with(null, () => null)
    .exhaustive();

  return (
    <SettingsSection icon={FolderOpen} title="パス設定">
      <div
        className={`${SURFACE_COLOR.muted} rounded-lg ${SPACING.padding.card}`}
      >
        <div className={SPACING.stack.relaxed}>
          {/* Photo Directory Section */}
          <SettingsPathInput
            label={t('settings.paths.photoDirectory')}
            value={photoInputValue}
            onChange={handlePhotoInputChange}
            onBrowse={handleBrowsePhotoDirectory}
            onSave={handlePhotoPathSave}
            isManuallyChanged={isPhotoPathManuallyChanged}
            error={photoValidationErrorMessage}
            placeholder="/path/to/photos"
            browseLabel={`${t('settings.paths.browse')}-${t('settings.paths.photoDirectory')}`}
            saveLabel={`${t('common.submit')}-${t('settings.paths.photoDirectory')}`}
          />

          {/* Extra Directories */}
          <div className={SPACING.stack.default}>
            <label
              className={`${TYPOGRAPHY.body.emphasis} ${TEXT_COLOR.secondary}`}
            >
              追加で読み込ませる写真フォルダ
            </label>
            <div className={SPACING.stack.default}>
              {extraDirs.map((dir: string, index: number) => (
                <div key={`extra-dir-${dir}`} className="flex gap-2">
                  <Input type="text" value={dir} readOnly className="flex-1" />
                  <Button
                    type="button"
                    onClick={() => handleRemoveExtraDirectory(index)}
                    aria-label={t('settings.paths.removeExtraDirectory')}
                    variant="secondary"
                    size="sm"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                onClick={handleBrowseExtraDirectory}
                aria-label={t('settings.paths.addExtraDirectory')}
                variant="secondary"
                size="sm"
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                フォルダを追加
              </Button>
            </div>
          </div>

          {/* Log File Section */}
          <SettingsPathInput
            label={t('settings.paths.logFile')}
            value={logInputValue}
            onChange={handleLogInputChange}
            onBrowse={handleBrowseLogFile}
            onSave={handleLogPathSave}
            isManuallyChanged={isLogPathManuallyChanged}
            error={logValidationErrorMessage}
            placeholder="/path/to/photo-logs.json"
            browseLabel={`${t('settings.paths.browse')}-${t('settings.paths.logFile')}`}
            saveLabel={`${t('common.submit')}-${t('settings.paths.logFile')}`}
          />

          {/* Refresh All Section */}
          {showRefreshAll && (
            <div className="pt-4 border-t border-border">
              <div className={SPACING.stack.default}>
                <p
                  className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.secondary}`}
                >
                  設定したVRChatのログファイルから、過去のワールド訪問履歴を含む全てのインデックスを再構築します。
                  初回設定時や、インデックスの不整合が発生した場合に使用してください。
                </p>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleRefreshAll}
                    disabled={isRefreshing}
                    aria-label={t('common.refresh')}
                  >
                    <RefreshCw
                      className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`}
                    />
                    {t('common.refresh')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
});

PathSettingsComponent.displayName = 'PathSettings';

export default PathSettingsComponent;
