import { format } from 'date-fns';
import type React from 'react';
import { memo, useState } from 'react';

import { cn } from '@/components/lib/utils';
import { trpcClient, trpcReact } from '@/trpc';

import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import {
  BORDER,
  SPACING,
  STATUS_BADGE,
  TEXT_COLOR,
  TYPOGRAPHY,
} from '../../constants/ui';
import { useToast } from '../../hooks/use-toast';
import { useI18n } from '../../i18n/store';
import { SettingsInfoBox, SettingsSection } from './common';

// Note: ImportHistoryItem interface is used for documentation purposes
// The actual type comes from the tRPC query result

/**
 * Cross-platform helper to extract filename from path
 * Handles both forward slashes (Unix/Mac) and backslashes (Windows)
 */
const getFilenameFromPath = (filePath: string): string => {
  // Split by both forward slashes and backslashes
  const parts = filePath.split(/[/\\]/);
  const filename = parts.at(-1);
  // 空文字の場合（パスがセパレータで終わる場合）、手前のパーツを返す
  if (filename) {
    return filename;
  }
  const parent = parts.at(-2);
  if (parent) {
    return parent;
  }
  return filePath;
};

/**
 * ログデータのインポート機能を提供するコンポーネント
 * SettingsModal内のデータインポートタブから利用される
 */
const DataImport = memo(() => {
  const { t } = useI18n();
  const { toast } = useToast();
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // インポート履歴を取得
  const {
    data: importHistory,
    isLoading: isLoadingHistory,
    refetch: refetchHistory,
  } = trpcReact.vrchatLog.getImportBackupHistory.useQuery();

  // ファイル選択
  const selectFiles = async () => {
    // effect-lint-allow-try-catch: React フロントエンド境界
    try {
      const filePaths = await trpcClient.electronUtil.openGetFileDialog.query([
        'openFile',
        'multiSelections',
      ]);

      if (filePaths && filePaths.length > 0) {
        setSelectedPaths(filePaths);
        toast({
          title: 'ファイル選択完了',
          description: `${filePaths.length}個のファイルが選択されました`,
        });
      }
    } catch (error) {
      console.error('Failed to select files:', error);
      toast({
        title: 'ファイル選択エラー',
        description: 'ファイルの選択に失敗しました',
        variant: 'destructive',
      });
    }
  };

  // ディレクトリ選択
  const selectDirectory = async () => {
    // effect-lint-allow-try-catch: React フロントエンド境界
    try {
      const dirPath = await trpcClient.electronUtil.openGetDirDialog.query();

      if (dirPath) {
        setSelectedPaths([dirPath]);
        toast({
          title: 'ディレクトリ選択完了',
          description: `ディレクトリが選択されました: ${getFilenameFromPath(
            dirPath,
          )}`,
        });
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
      toast({
        title: 'ディレクトリ選択エラー',
        description: 'ディレクトリの選択に失敗しました',
        variant: 'destructive',
      });
    }
  };

  // ドラッグ&ドロップハンドラ
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = [...e.dataTransfer.files];
    // Electron adds 'path' property to File objects for drag & drop
    const filePaths = files.map(
      (file) => (file as File & { path: string }).path,
    );

    if (filePaths.length === 0) {
      toast({
        title: 'ドロップエラー',
        description: 'ファイルまたはディレクトリをドロップしてください',
        variant: 'destructive',
      });
      return;
    }

    setSelectedPaths(filePaths);
    toast({
      title: 'ファイルドロップ完了',
      description: `${filePaths.length}個のアイテムがドロップされました`,
    });
  };

  // インポート実行
  const { mutate: importFiles, isPending: isImporting } =
    trpcReact.vrchatLog.importLogStoreFiles.useMutation({
      onSuccess: (result) => {
        toast({
          title: 'インポート完了',
          description: `${result.importedData.totalLines}行のログをインポートしました`,
          duration: 5000,
        });
        setSelectedPaths([]);
        void refetchHistory();
      },
      onError: (error) => {
        toast({
          title: 'インポートエラー',
          description: error.message,
          variant: 'destructive',
          duration: 8000,
        });
      },
    });

  // ロールバック実行
  const { mutate: rollbackToBackup, isPending: isRollingBack } =
    trpcReact.vrchatLog.rollbackToBackup.useMutation({
      onSuccess: () => {
        toast({
          title: 'ロールバック完了',
          description:
            'データが復帰されました。アプリケーションを再起動することをお勧めします。',
          duration: 8000,
        });
        void refetchHistory();
      },
      onError: (error) => {
        toast({
          title: 'ロールバックエラー',
          description: error.message,
          variant: 'destructive',
          duration: 8000,
        });
      },
    });

  const handleImport = () => {
    if (selectedPaths.length === 0) {
      toast({
        title: '入力エラー',
        description:
          'インポートするファイルまたはディレクトリを選択してください',
        variant: 'destructive',
      });
      return;
    }

    importFiles({ filePaths: selectedPaths });
  };

  const handleRollback = (backupId: string) => {
    rollbackToBackup({ backupId });
  };

  return (
    <SettingsSection
      title="ログデータインポート"
      description="エクスポートされたlogStoreファイルを既存のデータに統合します"
    >
      {/* ファイル選択・ドロップエリア */}
      <div className={SPACING.stack.default}>
        <Label
          className={`${TYPOGRAPHY.body.emphasis} ${TEXT_COLOR.secondary}`}
        >
          インポートファイル
        </Label>

        {/* ドロップエリア: 機能的に borderが必須なので dashed を維持 */}
        <div
          className={cn(
            'border border-dashed rounded-md px-6 py-10 text-center transition-colors',
            isDragOver ? 'border-primary/60 bg-primary/5' : 'border-border/60',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p
            className={cn(TYPOGRAPHY.body.small, TEXT_COLOR.secondary, 'mb-4')}
          >
            logStoreファイルやディレクトリをドラッグ&amp;ドロップするか、下のボタンで選択してください
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void selectFiles()}
              size="sm"
            >
              ファイル選択
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void selectDirectory()}
              size="sm"
            >
              ディレクトリ選択
            </Button>
          </div>
        </div>

        {/* 選択されたパス一覧: border や背景色ではなく、インデントと muted テキストで区別する */}
        {selectedPaths.length > 0 && (
          <div className={SPACING.stack.tight}>
            <Label
              className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.secondary}`}
            >
              選択されたアイテム ({selectedPaths.length}個)
            </Label>
            <ul className="max-h-32 overflow-y-auto space-y-1 pl-1">
              {selectedPaths.map((pathItem) => (
                <li key={pathItem} className={TYPOGRAPHY.body.small}>
                  <div className={TEXT_COLOR.primary}>
                    {getFilenameFromPath(pathItem)}
                  </div>
                  <div className={`${TEXT_COLOR.muted} truncate`}>
                    {pathItem}
                  </div>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedPaths([])}
              className="text-xs self-start"
            >
              選択をクリア
            </Button>
          </div>
        )}
      </div>

      {/* インポート: ラベルのみの自然な幅のプライマリアクション */}
      <div className="flex">
        <Button
          onClick={handleImport}
          disabled={isImporting || selectedPaths.length === 0}
        >
          {isImporting ? 'インポート中...' : 'インポート開始'}
        </Button>
      </div>

      {/* 説明 */}
      <SettingsInfoBox title="インポート機能について" variant="info">
        <ul className="space-y-1">
          <li>・logStoreファイルまたはディレクトリを既存データに統合します</li>
          <li>
            ・ディレクトリ指定の場合、再帰的にlogStoreファイルを検索します
          </li>
          <li>・インポート前に自動的にバックアップが作成されます</li>
          <li>・重複データは自動的に除外されます</li>
          <li>・インポート後、データベースが自動的に更新されます</li>
          <li>・ロールバック機能で元の状態に戻すことができます</li>
        </ul>
      </SettingsInfoBox>

      {/* インポート履歴・ロールバック: border ではなく大きな余白で区切る */}
      <div className={cn('pt-4', SPACING.stack.relaxed)}>
        <div className="flex items-center justify-between">
          <div className={SPACING.stack.tight}>
            <h4 className={cn(TYPOGRAPHY.heading.tertiary, TEXT_COLOR.primary)}>
              インポート履歴・ロールバック
            </h4>
            <p className={cn(TYPOGRAPHY.body.small, TEXT_COLOR.secondary)}>
              {t('settings.dataImport.historyDescription')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetchHistory()}
            disabled={isLoadingHistory}
          >
            更新
          </Button>
        </div>

        {(() => {
          if (isLoadingHistory) {
            return (
              <div className={cn(TYPOGRAPHY.body.small, TEXT_COLOR.muted)}>
                履歴を読み込み中...
              </div>
            );
          }
          if (importHistory && importHistory.length > 0) {
            return (
              <ul className={BORDER.listDivide}>
                {importHistory.map((backup) => (
                  <li
                    key={backup.id}
                    className="flex items-start justify-between gap-4 py-4"
                  >
                    <div className={cn('flex-1 min-w-0', SPACING.stack.tight)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            TYPOGRAPHY.body.emphasis,
                            TEXT_COLOR.primary,
                            'truncate',
                          )}
                        >
                          {backup.exportFolderPath}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                            backup.status === 'completed'
                              ? STATUS_BADGE.success
                              : STATUS_BADGE.muted,
                          )}
                        >
                          {backup.status === 'completed'
                            ? '適用済み'
                            : 'ロールバック済み'}
                        </span>
                      </div>
                      <div
                        className={cn(
                          TYPOGRAPHY.body.small,
                          TEXT_COLOR.muted,
                          'space-y-0.5',
                        )}
                      >
                        <div className="flex items-center gap-4 flex-wrap">
                          <span>
                            バックアップ:{' '}
                            {format(
                              new Date(backup.backupTimestamp),
                              'yyyy/MM/dd HH:mm:ss',
                            )}
                          </span>
                          <span>
                            インポート:{' '}
                            {format(
                              new Date(backup.importTimestamp),
                              'yyyy/MM/dd HH:mm:ss',
                            )}
                          </span>
                        </div>
                        <div>
                          {backup.totalLogLines.toLocaleString()}行 /{' '}
                          {backup.exportedFiles.length}ファイル
                        </div>
                        {backup.sourceFiles.length > 0 && (
                          <div className="text-primary/80 truncate">
                            インポート元:{' '}
                            {backup.sourceFiles
                              .map((f) => getFilenameFromPath(f))
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                    {backup.status === 'completed' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRollback(backup.id)}
                        disabled={isRollingBack}
                        className="text-destructive hover:text-destructive flex-shrink-0"
                      >
                        この時点に戻す
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <div className={cn(TYPOGRAPHY.body.small, TEXT_COLOR.muted)}>
              インポート履歴がありません
            </div>
          );
        })()}
      </div>
    </SettingsSection>
  );
});

DataImport.displayName = 'DataImport';

export default DataImport;
