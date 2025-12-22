import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { match, P } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import {
  BackupPathObjectSchema,
  type ExportPathObject,
  ExportPathObjectSchema,
} from '../../../lib/pathObject';
import { getAppUserDataPath } from '../../../lib/wrappedApp';
import type { LogRecord } from '../converters/dbToLogStore';
import { exportLogStoreFromDB } from '../exportService/exportService';

/**
 * インポートバックアップのメタデータ
 */
export interface ImportBackupMetadata {
  id: string;
  backupTimestamp: Date;
  exportFolderPath: string; // vrchat-albums-export_2023-12-01_14-30-45
  sourceFiles: string[]; // インポート元ファイル一覧
  status: 'completed' | 'rolled_back';
  importTimestamp: Date; // インポート実行日時
  totalLogLines: number; // バックアップに含まれるログ行数
  exportedFiles: string[]; // エクスポートされたファイル一覧
}

export type DBLogProvider = (
  startDate?: Date,
  endDate?: Date,
) => Promise<LogRecord[]>;

/**
 * バックアップサービス
 * 既存のエクスポート機能を活用してインポート前のデータバックアップを作成
 *
 * @see docs/app-event-export-import.md - エクスポート/インポート仕様
 * @see ImportService - インポート処理
 * @see RollbackService - ロールバック処理
 */
export class BackupService {
  /**
   * インポート前バックアップ作成（既存エクスポート機能活用）
   */
  async createPreImportBackup(
    getDBLogs: DBLogProvider,
  ): Promise<neverthrow.Result<ImportBackupMetadata, Error>> {
    const backupTimestamp = new Date();

    try {
      logger.info('Creating pre-import backup using export functionality');

      // 1. 既存エクスポート機能で全データエクスポート
      const exportResult = await exportLogStoreFromDB(
        {
          // 全期間エクスポート（startDate/endDate指定なし）
          outputBasePath: this.getBackupBasePath(),
        },
        getDBLogs,
      );

      // エクスポートファイルが存在しない場合（空のDB）
      if (exportResult.exportedFiles.length === 0) {
        logger.info('No data to backup (empty database)');
        // 空のバックアップメタデータを作成
        const backupId = this.generateBackupId(backupTimestamp);
        const metadata: ImportBackupMetadata = {
          id: backupId,
          backupTimestamp,
          exportFolderPath: '', // 空のDB時はエクスポートフォルダなし
          sourceFiles: [],
          status: 'completed',
          importTimestamp: backupTimestamp,
          totalLogLines: 0,
          exportedFiles: [],
        };
        return neverthrow.ok(metadata);
      }

      // 2. バックアップメタデータ作成
      const backupId = this.generateBackupId(backupTimestamp);
      const exportPath = ExportPathObjectSchema.parse(
        exportResult.exportedFiles[0],
      );
      const exportFolderPath = this.extractExportFolderPath(exportPath);

      const metadata: ImportBackupMetadata = {
        id: backupId,
        backupTimestamp,
        exportFolderPath,
        sourceFiles: [], // インポート時に設定
        status: 'completed',
        importTimestamp: backupTimestamp,
        totalLogLines: exportResult.totalLogLines,
        exportedFiles: exportResult.exportedFiles,
      };

      // 3. メタデータファイル保存
      await this.saveBackupMetadata(exportFolderPath, metadata);

      logger.info(
        `Pre-import backup created successfully: ${backupId}, files: ${exportResult.exportedFiles.length}`,
      );

      return neverthrow.ok(metadata);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((err) => String(err));

      logger.error({
        message: `Failed to create pre-import backup: ${errorMessage}`,
        stack: error instanceof Error ? error : new Error(String(error)),
      });

      return neverthrow.err(
        new Error(`バックアップ作成に失敗しました: ${errorMessage}`),
      );
    }
  }

  /**
   * バックアップメタデータを更新
   */
  async updateBackupMetadata(
    metadata: ImportBackupMetadata,
  ): Promise<neverthrow.Result<void, Error>> {
    try {
      await this.saveBackupMetadata(metadata.exportFolderPath, metadata);
      logger.info(`Backup metadata updated: ${metadata.id}`);
      return neverthrow.ok(undefined);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((err) => String(err));

      logger.error({
        message: `Failed to update backup metadata: ${errorMessage}`,
        stack: error instanceof Error ? error : new Error(String(error)),
      });

      return neverthrow.err(
        new Error(
          `バックアップメタデータの更新に失敗しました: ${errorMessage}`,
        ),
      );
    }
  }

  /**
   * バックアップ履歴を取得
   */
  async getBackupHistory(): Promise<
    neverthrow.Result<ImportBackupMetadata[], Error>
  > {
    try {
      const backupBasePath = this.getBackupBasePath();

      // バックアップディレクトリが存在しない場合は空配列を返す
      try {
        await fs.access(backupBasePath);
      } catch {
        return neverthrow.ok([]);
      }

      const entries = await fs.readdir(backupBasePath, { withFileTypes: true });
      const backupFolders = entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith('vrchat-albums-export_'),
        )
        .map((entry) => entry.name);

      const backups: ImportBackupMetadata[] = [];

      for (const folderName of backupFolders) {
        try {
          const metadataPath = path.join(
            backupBasePath,
            folderName,
            'backup-metadata.json',
          );
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent) as ImportBackupMetadata;

          // Date オブジェクトに変換
          metadata.backupTimestamp = new Date(metadata.backupTimestamp);
          metadata.importTimestamp = new Date(metadata.importTimestamp);

          backups.push(metadata);
        } catch (error) {
          logger.warn(
            `Failed to read backup metadata for ${folderName}: ${String(
              error,
            )}`,
          );
        }
      }

      // 作成日時で降順ソート（新しいものが先頭）
      backups.sort((a, b) =>
        datefns.compareDesc(a.backupTimestamp, b.backupTimestamp),
      );

      return neverthrow.ok(backups);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((err) => String(err));

      logger.error({
        message: `Failed to get backup history: ${errorMessage}`,
        stack: error instanceof Error ? error : new Error(String(error)),
      });

      return neverthrow.err(
        new Error(`バックアップ履歴の取得に失敗しました: ${errorMessage}`),
      );
    }
  }

  /**
   * 指定されたIDのバックアップを取得
   */
  async getBackup(
    backupId: string,
  ): Promise<neverthrow.Result<ImportBackupMetadata, Error>> {
    const historyResult = await this.getBackupHistory();
    if (historyResult.isErr()) {
      return neverthrow.err(historyResult.error);
    }

    const backup = historyResult.value.find((b) => b.id === backupId);
    if (!backup) {
      return neverthrow.err(
        new Error(`バックアップが見つかりません: ${backupId}`),
      );
    }

    return neverthrow.ok(backup);
  }

  /**
   * バックアップの基本パスを取得
   */
  getBackupBasePath(): string {
    return path.join(getAppUserDataPath(), 'backups');
  }

  /**
   * バックアップIDを生成
   */
  private generateBackupId(timestamp: Date): string {
    return `backup_${datefns.format(timestamp, 'yyyyMMdd_HHmmss')}`;
  }

  /**
   * エクスポートファイルパスからエクスポートフォルダ名を抽出
   */
  private extractExportFolderPath(exportPath: ExportPathObject): string {
    // パストラバーサルチェック
    const backupBasePath = BackupPathObjectSchema.parse(
      this.getBackupBasePath(),
    );
    if (!exportPath.isWithin(backupBasePath)) {
      throw new Error(
        `Export file path is outside backup directory: ${exportPath.value}`,
      );
    }

    const exportFolderName = exportPath.extractExportFolderName();
    if (!exportFolderName) {
      throw new Error(`Invalid export file path: ${exportPath.value}`);
    }

    return exportFolderName;
  }

  /**
   * バックアップメタデータを保存
   */
  private async saveBackupMetadata(
    exportFolderPath: string,
    metadata: ImportBackupMetadata,
  ): Promise<void> {
    const metadataPath = path.join(
      this.getBackupBasePath(),
      exportFolderPath,
      'backup-metadata.json',
    );

    // ディレクトリが存在することを確認
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }
}

// デフォルトインスタンスをエクスポート
export const backupService = new BackupService();
