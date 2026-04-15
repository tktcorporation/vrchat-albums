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
  STATUS_BADGE,
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
      icon={Upload}
      title="ログデータインポート"
      description="エクスポートされたlogStoreファイルを既存のデータに統合します"
    >
      <div className="space-y-10">
        {/* ファイル選択・ドロップエリア */}
        <div className="space-y-5">
          <Label className="text-[12px] text-muted-foreground/45">
            インポートファイル
          </Label>

          {/* ドロップエリア — ボーダーなし、背景だけ */}
          <div
            className={`rounded-2xl py-12 px-8 text-center transition-all duration-200 ease-spring ${
              isDragOver ? 'bg-primary/[0.06] scale-[1.01]' : 'bg-muted/20'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="h-6 w-6 mx-auto mb-4 text-muted-foreground/25" />
            <p className="text-[12px] text-muted-foreground/40 mb-5 leading-relaxed">
              logStoreファイルやディレクトリをドラッグ&amp;ドロップするか、下のボタンで選択してください
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void selectFiles()}
                size="sm"
                className="text-muted-foreground/50 hover:text-foreground"
              >
                <FileText className="h-4 w-4 mr-2" />
                ファイル選択
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void selectDirectory()}
                size="sm"
                className="text-muted-foreground/50 hover:text-foreground"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                ディレクトリ選択
              </Button>
            </div>
          </div>

          {/* 選択されたパス一覧 */}
          {selectedPaths.length > 0 && (
            <div className="space-y-4">
              <Label className="text-[12px] text-muted-foreground/45">
                選択されたアイテム ({selectedPaths.length}個)
              </Label>
              <div className="max-h-32 overflow-y-auto space-y-2">
                {selectedPaths.map((pathItem) => (
                  <div
                    key={pathItem}
                    className="text-[12px] text-foreground/70 bg-muted/20 px-4 py-3 rounded-xl"
                  >
                    {getFilenameFromPath(pathItem)}
                    <div className="text-muted-foreground/35 truncate mt-0.5">
                      {pathItem}
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPaths([])}
                className="text-xs text-muted-foreground/50"
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
      <div className="pt-12">
        <div className="flex items-center justify-between mb-8">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/35">
            インポート履歴・ロールバック
          </h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetchHistory()}
            disabled={isLoadingHistory}
            className="text-muted-foreground/40 hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-2" />
            更新
          </Button>
        </div>

        {(() => {
          if (isLoadingHistory) {
            return (
              <div className="text-center py-4">
                <div className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.muted}`}>
                  履歴を読み込み中...
                </div>
              </div>
            );
          }
          if (importHistory && importHistory.length > 0) {
            return (
              <div className={SPACING.stack.default}>
                {importHistory.map((backup) => (
                  <div
                    key={backup.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/30"
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
                              ? STATUS_BADGE.success
                              : STATUS_BADGE.muted
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
            );
          }
          return (
            <div className="text-center py-8">
              <div className={`${TYPOGRAPHY.body.small} ${TEXT_COLOR.muted}`}>
                インポート履歴がありません
              </div>
            </div>
          );
        })()}
      </div>
    </SettingsSection>
  );
});

DataImport.displayName = 'DataImport';

export default DataImport;
