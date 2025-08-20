import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpcReact } from '@/trpc';
import {
  AlertCircle,
  FolderOpen,
  Info,
  Plus,
  RefreshCw,
  Save,
  Trash,
} from 'lucide-react';
import React, { memo, useState, useEffect } from 'react';
import { match } from 'ts-pattern';
import { LOG_SYNC_MODE, useLogSync } from '../../hooks/useLogSync';
import { useVRChatPhotoExtraDirList } from '../../hooks/useVRChatPhotoExtraDirList';
import { useI18n } from '../../i18n/store';

interface PathSettingsProps {
  showRefreshAll: boolean;
}
/**
 * VRChat のログ・写真フォルダを設定する画面。
 * データソース変更時のリフレッシュ処理もここから行われる。
 */
const PathSettingsComponent = memo(({ showRefreshAll }: PathSettingsProps) => {
  const { t } = useI18n();
  const [_isValidating, setIsValidating] = useState(false);
  const [_validationError, setValidationError] = useState<string | null>(null);

  // ログ同期フックを使用
  const { sync: syncLogs, isLoading: isRefreshing } = useLogSync({
    onSuccess: () => {
      // 同期完了時の処理
      console.log('Log sync completed successfully');
    },
    onError: (error) => {
      console.error('Failed to sync logs:', error);
    },
  });

  // Photo directory queries and mutations
  const { data: photoDir, refetch: refetchPhotoDir } =
    trpcReact.vrchatPhoto.getVRChatPhotoDirPath.useQuery();
  const validatePhotoPathMutation =
    trpcReact.vrchatPhoto.validateVRChatPhotoPath.useMutation();
  const setPhotoDirectoryMutation =
    trpcReact.vrchatPhoto.setVRChatPhotoDirPathToSettingStore.useMutation();
  const setPhotoPathDirectlyMutation =
    trpcReact.vrchatPhoto.setVRChatPhotoDirPathDirectly.useMutation();
  const _clearPhotoDirectoryMutation =
    trpcReact.vrchatPhoto.clearVRChatPhotoDirPathInSettingStore.useMutation();

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

  // 写真ディレクトリの状態管理（ログファイルと同じパターン）
  const [photoInputValue, setPhotoInputValue] = useState('');
  const [isPhotoPathManuallyChanged, setIsPhotoPathManuallyChanged] =
    useState(false);

  useEffect(() => {
    if (logFilesDir?.path) {
      setLogInputValue(logFilesDir.path);
    } else {
      setLogInputValue(''); // パスがない場合は空文字に
    }
    setIsLogPathManuallyChanged(false); // 初期読み込み時や参照ボタンでの変更後は手動変更フラグをリセット
  }, [logFilesDir?.path]);

  useEffect(() => {
    if (photoDir?.value) {
      setPhotoInputValue(photoDir.value);
    } else {
      setPhotoInputValue(''); // パスがない場合は空文字に
    }
    setIsPhotoPathManuallyChanged(false); // 初期読み込み時や参照ボタンでの変更後は手動変更フラグをリセット
  }, [photoDir?.value]);

  // 写真パスの検証状態を保持
  const [photoValidationResult, _setPhotoValidationResult] = useState<
    'MODEL_NOT_FOUND' | 'FILE_NOT_FOUND_MODEL_DELETED' | 'VALID' | null
  >(null);

  // 写真パスの検証を行う関数
  /** 設定された写真ディレクトリが有効か確認する */
  const validatePhotoPath = async () => {
    // if (!photoDir?.value) return;
    // const result = await validatePhotoPathMutation.mutateAsync(photoDir.value);
    // setPhotoValidationResult(result.result);
  };

  // 写真ディレクトリが変更されたら検証を実行
  React.useEffect(() => {
    validatePhotoPath();
  }, [photoDir?.value]);

  /** 写真パスとログパスをまとめて検証する */
  const _validatePaths = async () => {
    setIsValidating(true);
    setValidationError(null);

    try {
      // 写真ディレクトリの検証
      if (!photoDir?.value) {
        throw new Error('写真ディレクトリが設定されていません');
      }
      const photoResult = await validatePhotoPathMutation.mutateAsync(
        photoDir.value,
      );

      const photoValidationError = match(photoResult.result)
        .with(
          'MODEL_NOT_FOUND',
          () => '写真ディレクトリのモデルが見つかりません',
        )
        .with(
          'FILE_NOT_FOUND_MODEL_DELETED',
          () => '写真ディレクトリが存在しないため、モデルを削除しました',
        )
        .with('VALID', () => null)
        .exhaustive();

      if (photoValidationError) {
        throw new Error(photoValidationError);
      }

      // ログファイルの検証
      if (!logFilesDir?.path) {
        throw new Error('ログファイルのパスが設定されていません');
      }

      const logValidationError = match(logFilesDir.error)
        .with('logFilesNotFound', () => 'ログファイルが見つかりませんでした')
        .with('logFileDirNotFound', () => 'フォルダの読み取りに失敗しました')
        .with(null, () => null)
        .exhaustive();

      if (logValidationError) {
        throw new Error(logValidationError);
      }
    } catch (_error) {
      setValidationError('写真ディレクトリの選択中にエラーが発生しました');
    } finally {
      setIsValidating(false);
    }
  };

  /** フォトディレクトリ選択ダイアログを開く */
  const handleBrowsePhotoDirectory = async () => {
    try {
      const result = await setPhotoDirectoryMutation.mutateAsync();
      if (result) {
        await refetchPhotoDir();
      }
    } catch (_error) {
      setValidationError('写真ディレクトリの選択中にエラーが発生しました');
    }
  };

  /** ログファイル選択ダイアログを開く */
  const handleBrowseLogFile = async () => {
    try {
      const result = await setLogPathMutation.mutateAsync();
      if (result) {
        await refetchLogFilesDir();
        setIsLogPathManuallyChanged(false);
      }
    } catch (_error) {
      setValidationError('ログファイルの選択中にエラーが発生しました');
    }
  };

  /** ログファイル入力欄の変更を処理する */
  const handleLogInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLogInputValue(event.target.value);
    setIsLogPathManuallyChanged(
      event.target.value !== (logFilesDir?.path || ''),
    );
  };

  /** ログファイルパスを保存する */
  const handleLogPathSave = async () => {
    try {
      await setLogPathDirectlyMutation.mutateAsync(logInputValue, {
        onSuccess: async () => {
          await refetchLogFilesDir();
          setIsLogPathManuallyChanged(false);
          setValidationError(null);
        },
        onError: () => {
          setValidationError('ログファイルのパス保存中にエラーが発生しました');
        },
      });
    } catch (_error) {
      setValidationError(
        'ログファイルのパス保存中に予期せぬエラーが発生しました',
      );
    }
  };

  // 写真ディレクトリ用のハンドラー関数（ログファイルと同じパターン）
  /** 写真ディレクトリ入力欄の変更を処理する */
  const handlePhotoInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setPhotoInputValue(event.target.value);
    setIsPhotoPathManuallyChanged(
      event.target.value !== (photoDir?.value || ''),
    );
  };

  /** 写真ディレクトリのパスを保存する */
  const handlePhotoPathSave = async () => {
    try {
      await setPhotoPathDirectlyMutation.mutateAsync(photoInputValue, {
        onSuccess: async () => {
          await refetchPhotoDir();
          setIsPhotoPathManuallyChanged(false);
          setValidationError(null);
        },
        onError: () => {
          setValidationError(
            '写真ディレクトリのパス保存中にエラーが発生しました',
          );
        },
      });
    } catch (_error) {
      setValidationError(
        '写真ディレクトリのパス保存中に予期せぬエラーが発生しました',
      );
    }
  };

  /**
   * 全データの再読み込みを行う関数
   *
   * 重要な処理順序：
   * 1. appendLoglines: VRChatログファイルから新しいログ行を読み込む
   * 2. その成功後に loadLogInfo: ログ情報をDBに保存
   * 3. その成功後に キャッシュの無効化: UIを更新
   *
   * この順序が重要な理由：
   * - この順序で処理しないと、新しいワールド参加ログがDBに保存されず、
   *   新しい写真が古いワールドグループに誤って割り当てられます
   */
  /** すべてのログを再読み込みしてインデックスを再構築する */
  const handleRefreshAll = async () => {
    if (!isRefreshing) {
      // 全件処理モードでログを同期
      await syncLogs(LOG_SYNC_MODE.FULL);
    }
  };

  /** 追加読み込み用フォルダを選択する */
  const handleBrowseExtraDirectory = async () => {
    const result = await showOpenDialogMutation.mutateAsync({
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setExtraDirs([...extraDirs, result.filePaths[0]]);
    }
  };

  /** 追加フォルダリストから指定インデックスを削除する */
  const handleRemoveExtraDirectory = (index: number) => {
    const newDirs = [...extraDirs];
    newDirs.splice(index, 1);
    setExtraDirs(newDirs);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Addon Information */}
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-1">
                {t('settings.paths.addonInfo.title')}
              </p>
              <p>{t('settings.paths.addonInfo.description')}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          {/* Photo Directory Section */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.paths.photoDirectory')}
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                aria-label={`input-${t('settings.paths.photoDirectory')}`}
                value={photoInputValue}
                onChange={handlePhotoInputChange}
                placeholder="/path/to/photos"
                className="flex-1"
              />
              {isPhotoPathManuallyChanged ? (
                <Button
                  type="button"
                  aria-label={`${t('common.submit')}-${t(
                    'settings.paths.photoDirectory',
                  )}`}
                  variant="default"
                  size="sm"
                  onClick={handlePhotoPathSave}
                >
                  <Save className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  aria-label={`${t('settings.paths.browse')}-${t(
                    'settings.paths.photoDirectory',
                  )}`}
                  variant="secondary"
                  size="sm"
                  onClick={handleBrowsePhotoDirectory}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
            </div>
            {photoValidationResult && photoValidationResult !== 'VALID' && (
              <div className="flex items-center text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 mr-1" />
                {match(photoValidationResult)
                  .with(
                    'MODEL_NOT_FOUND',
                    () => '写真ディレクトリのモデルが見つかりません',
                  )
                  .with(
                    'FILE_NOT_FOUND_MODEL_DELETED',
                    () =>
                      '写真ディレクトリが存在しないため、モデルを削除しました',
                  )
                  .exhaustive()}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                追加で読み込ませる写真フォルダ
              </label>
              <div className="mt-1 space-y-2">
                {extraDirs.map((dir: string, index: number) => (
                  <div key={`extra-dir-${dir}`} className="flex gap-2">
                    <Input
                      type="text"
                      value={dir}
                      readOnly
                      className="flex-1"
                    />
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
          </div>

          {/* Log File Section */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.paths.logFile')}
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                aria-label={`input-${t('settings.paths.logFile')}`}
                value={logInputValue}
                onChange={handleLogInputChange}
                placeholder="/path/to/photo-logs.json"
                className="flex-1"
              />
              {isLogPathManuallyChanged ? (
                <Button
                  type="button"
                  aria-label={`${t('common.submit')}-${t(
                    'settings.paths.logFile',
                  )}`}
                  variant="default"
                  size="sm"
                  onClick={handleLogPathSave}
                >
                  <Save className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  aria-label={`${t('settings.paths.browse')}-${t(
                    'settings.paths.logFile',
                  )}`}
                  variant="secondary"
                  size="sm"
                  onClick={handleBrowseLogFile}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
            </div>
            {logFilesDir?.error && (
              <div className="flex items-center text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 mr-1" />
                {match(logFilesDir.error)
                  .with(
                    'logFilesNotFound',
                    () => 'ログファイルが見つかりませんでした',
                  )
                  .with(
                    'logFileDirNotFound',
                    () => 'フォルダの読み取りに失敗しました',
                  )
                  .exhaustive()}
              </div>
            )}
          </div>

          {showRefreshAll && (
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-col gap-2">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  設定したVRChatのログファイルから、過去のワールド訪問履歴を含む全てのインデックスを再構築します。
                  初回設定時や、インデックスの不整合が発生した場合に使用してください。
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleRefreshAll}
                    disabled={isRefreshing}
                    aria-label={t('common.refresh')}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${
                        isRefreshing ? 'animate-spin' : ''
                      }`}
                    />
                    {t('common.refresh')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

PathSettingsComponent.displayName = 'PathSettings';

export default PathSettingsComponent;
