import { format } from 'date-fns';
import {
  AlertTriangle,
  Clock,
  FileText,
  FolderOpen,
  RotateCcw,
  Upload,
} from 'lucide-react';
import type React from 'react';
import { memo, useState } from 'react';

import { trpcClient, trpcReact } from '@/trpc';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import {
  SPACING,
  SURFACE_COLOR,
  TEXT_COLOR,
  TYPOGRAPHY,
} from '../../constants/ui';
import { useToast } from '../../hooks/use-toast';
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
  const filename = parts[parts.length - 1];
  // If filename is empty (path ends with separator), try the second to last part
  return filename || parts[parts.length - 2] || filePath;
};

/**
 * ログデータのインポート機能を提供するコンポーネント
 * SettingsModal内のデータインポートタブから利用される
 */
const DataImport = memo(() => {
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

    const files = Array.from(e.dataTransfer.files);
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
        refetchHistory();
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
        refetchHistory();
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
      icon={Upload}
      title="ログデータインポート"
      description="エクスポートされたlogStoreファイルを既存のデータに統合します"
    >
      <div className={SPACING.stack.relaxed}>
        {/* ファイル選択・ドロップエリア */}
        <div className={SPACING.stack.default}>
          <Label
            className={`${TYPOGRAPHY.body.emphasis} ${TEXT_COLOR.secondary}`}
          >
            インポートファイル
          </Label>

          {/* ドロップエリア */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              isDragOver
                ? 'border-primary bg-primary/10 dark:bg-primary/20'
                : 'border-border'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className={`h-8 w-8 mx-auto mb-2 ${TEXT_COLOR.muted}`} />
            <p
              className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.secondary} mb-3`}
            >
              logStoreファイルやディレクトリをドラッグ&amp;ドロップするか、下のボタンで選択してください
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={selectFiles}
                size="sm"
              >
                <FileText className="h-4 w-4 mr-2" />
                ファイル選択
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={selectDirectory}
                size="sm"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                ディレクトリ選択
              </Button>
            </div>
          </div>

          {/* 選択されたパス一覧 */}
          {selectedPaths.length > 0 && (
            <div className={SPACING.stack.tight}>
              <Label
                className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.secondary}`}
              >
                選択されたアイテム ({selectedPaths.length}個)
              </Label>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {selectedPaths.map((pathItem) => (
                  <div
                    key={pathItem}
                    className="text-xs text-primary bg-primary/10 dark:bg-primary/20 p-2 rounded"
                  >
                    {getFilenameFromPath(pathItem)}
                    <div className={`${TEXT_COLOR.muted} truncate`}>
                      {pathItem}
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedPaths([])}
                className="text-xs"
              >
                選択をクリア
              </Button>
            </div>
          )}
        </div>

        {/* インポートボタン */}
        <div className="pt-4">
          <Button
            onClick={handleImport}
            disabled={isImporting || selectedPaths.length === 0}
            className="w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            {isImporting ? 'インポート中...' : 'インポート開始'}
          </Button>
        </div>

        {/* 説明 */}
        <SettingsInfoBox title="インポート機能について" variant="info">
          <ul className={`${TYPOGRAPHY.body.small} space-y-1`}>
            <li>
              • logStoreファイルまたはディレクトリを既存データに統合します
            </li>
            <li>
              • ディレクトリ指定の場合、再帰的にlogStoreファイルを検索します
            </li>
            <li>• インポート前に自動的にバックアップが作成されます</li>
            <li>• 重複データは自動的に除外されます</li>
            <li>• インポート後、データベースが自動的に更新されます</li>
            <li>• ロールバック機能で元の状態に戻すことができます</li>
          </ul>
        </SettingsInfoBox>
      </div>

      {/* インポート履歴・ロールバック */}
      <div className="border-t border-border pt-6">
        <div className="flex items-center justify-between mb-4">
          <h4
            className={`${TYPOGRAPHY.heading.subsection} ${TEXT_COLOR.primary}`}
          >
            インポート履歴・ロールバック
          </h4>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchHistory()}
            disabled={isLoadingHistory}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            更新
          </Button>
        </div>

        {isLoadingHistory ? (
          <div className="text-center py-4">
            <div className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.muted}`}>
              履歴を読み込み中...
            </div>
          </div>
        ) : importHistory && importHistory.length > 0 ? (
          <div className={SPACING.stack.default}>
            {importHistory.map((backup) => (
              <div
                key={backup.id}
                className={`flex items-center justify-between p-4 border border-border rounded-lg ${SURFACE_COLOR.muted}`}
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <div
                      className={`${TYPOGRAPHY.body.emphasis} ${TEXT_COLOR.primary}`}
                    >
                      {backup.exportFolderPath}
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        backup.status === 'completed'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {backup.status === 'completed'
                        ? '適用済み'
                        : 'ロールバック済み'}
                    </span>
                  </div>
                  <div
                    className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.muted} space-y-0.5`}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>
                          バックアップ:{' '}
                          {format(
                            new Date(backup.backupTimestamp),
                            'yyyy/MM/dd HH:mm:ss',
                          )}
                        </span>
                      </div>
                      <div>
                        インポート:{' '}
                        {format(
                          new Date(backup.importTimestamp),
                          'yyyy/MM/dd HH:mm:ss',
                        )}
                      </div>
                    </div>
                    <div>
                      {backup.totalLogLines.toLocaleString()}行 •{' '}
                      {backup.exportedFiles.length}ファイル
                    </div>
                    {backup.sourceFiles.length > 0 && (
                      <div className="text-primary">
                        インポート元:{' '}
                        {backup.sourceFiles
                          .map((f) => getFilenameFromPath(f))
                          .join(', ')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {backup.status === 'completed' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRollback(backup.id)}
                      disabled={isRollingBack}
                      className="text-destructive hover:text-destructive"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      この時点に戻す
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.muted}`}>
              インポート履歴がありません
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
});

DataImport.displayName = 'DataImport';

export default DataImport;
