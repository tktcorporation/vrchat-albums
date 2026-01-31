import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { match } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import {
  BackupPathObjectSchema,
  type ExportPathObject,
  ExportPathObjectSchema,
} from '../../../lib/pathObject';
import { getAppUserDataPath } from '../../../lib/wrappedApp';
import {
  exportLogStore,
  getExportErrorMessage,
} from '../exportService/exportService';

/**
 * バックアップエラー型
 * 呼び出し側でパターンマッチできるように具体的な型を定義
 * 予期しないエラーはthrowしてSentryに送信（ここには含めない）
 */
export type BackupError =
  | { type: 'EXPORT_FAILED'; message: string }
  | { type: 'METADATA_WRITE_FAILED'; path: string; message: string }
  | { type: 'METADATA_UPDATE_FAILED'; backupId: string; message: string }
  | { type: 'HISTORY_READ_FAILED'; message: string }
  | { type: 'BACKUP_NOT_FOUND'; backupId: string };

/**
 * BackupError からユーザー向けメッセージを取得
 */
export const getBackupErrorMessage = (error: BackupError): string =>
  match(error)
    .with(
      { type: 'EXPORT_FAILED' },
      (e) => `バックアップ作成に失敗しました: ${e.message}`,
    )
    .with(
      { type: 'METADATA_WRITE_FAILED' },
      (e) => `メタデータの保存に失敗しました (${e.path}): ${e.message}`,
    )
    .with(
      { type: 'METADATA_UPDATE_FAILED' },
      (e) =>
        `バックアップメタデータの更新に失敗しました (${e.backupId}): ${e.message}`,
    )
    .with(
      { type: 'HISTORY_READ_FAILED' },
      (e) => `バックアップ履歴の取得に失敗しました: ${e.message}`,
    )
    .with(
      { type: 'BACKUP_NOT_FOUND' },
      (e) => `バックアップが見つかりません: ${e.backupId}`,
    )
    .exhaustive();

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
  async createPreImportBackup(): Promise<
    neverthrow.Result<ImportBackupMetadata, BackupError>
  > {
    const backupTimestamp = new Date();

    logger.info('Creating pre-import backup using export functionality');

    // 1. 既存エクスポート機能で全データエクスポート（logStoreファイル直接コピー）
    const exportResultAsync = await exportLogStore({
      // 全期間エクスポート（startDate/endDate指定なし）
      outputBasePath: this.getBackupBasePath(),
    });

    if (exportResultAsync.isErr()) {
      return neverthrow.err({
        type: 'EXPORT_FAILED' as const,
        message: getExportErrorMessage(exportResultAsync.error),
      });
    }

    const exportResult = exportResultAsync.value;

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
    const saveResult = await this.saveBackupMetadata(
      exportFolderPath,
      metadata,
    );
    if (saveResult.isErr()) {
      return neverthrow.err(saveResult.error);
    }

    logger.info(
      `Pre-import backup created successfully: ${backupId}, files: ${exportResult.exportedFiles.length}`,
    );

    return neverthrow.ok(metadata);
  }

  /**
   * バックアップメタデータを更新
   */
  async updateBackupMetadata(
    metadata: ImportBackupMetadata,
  ): Promise<neverthrow.Result<void, BackupError>> {
    const saveResult = await this.saveBackupMetadata(
      metadata.exportFolderPath,
      metadata,
    );
    if (saveResult.isErr()) {
      return neverthrow.err({
        type: 'METADATA_UPDATE_FAILED',
        backupId: metadata.id,
        message: getBackupErrorMessage(saveResult.error),
      });
    }
    logger.info(`Backup metadata updated: ${metadata.id}`);
    return neverthrow.ok(undefined);
  }

  /**
   * バックアップ履歴を取得
   */
  async getBackupHistory(): Promise<
    neverthrow.Result<ImportBackupMetadata[], BackupError>
  > {
    const backupBasePath = this.getBackupBasePath();

    // バックアップディレクトリが存在しない場合は空配列を返す
    const accessResult = await neverthrow.ResultAsync.fromPromise(
      fs.access(backupBasePath),
      () => 'NOT_FOUND' as const,
    );
    if (accessResult.isErr()) {
      return neverthrow.ok([]);
    }

    // ディレクトリ一覧取得 - 失敗は予期しないエラーなのでthrow
    const entries = await fs.readdir(backupBasePath, { withFileTypes: true });
    const backupFolders = entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith('vrchat-albums-export_'),
      )
      .map((entry) => entry.name);

    const backups: ImportBackupMetadata[] = [];

    for (const folderName of backupFolders) {
      const metadataPath = path.join(
        backupBasePath,
        folderName,
        'backup-metadata.json',
      );

      // 個別のメタデータ読み込み失敗は警告のみで継続
      const readResult = await neverthrow.ResultAsync.fromPromise(
        fs.readFile(metadataPath, 'utf-8'),
        (e) => e,
      );
      if (readResult.isErr()) {
        logger.warn(
          `Failed to read backup metadata for ${folderName}: ${String(readResult.error)}`,
        );
        continue;
      }

      const metadata = JSON.parse(readResult.value) as ImportBackupMetadata;
      // Date オブジェクトに変換
      metadata.backupTimestamp = new Date(metadata.backupTimestamp);
      metadata.importTimestamp = new Date(metadata.importTimestamp);
      backups.push(metadata);
    }

    // 作成日時で降順ソート（新しいものが先頭）
    backups.sort((a, b) =>
      datefns.compareDesc(a.backupTimestamp, b.backupTimestamp),
    );

    return neverthrow.ok(backups);
  }

  /**
   * 指定されたIDのバックアップを取得
   */
  async getBackup(
    backupId: string,
  ): Promise<neverthrow.Result<ImportBackupMetadata, BackupError>> {
    const historyResult = await this.getBackupHistory();
    if (historyResult.isErr()) {
      return neverthrow.err(historyResult.error);
    }

    const backup = historyResult.value.find((b) => b.id === backupId);
    if (!backup) {
      return neverthrow.err({ type: 'BACKUP_NOT_FOUND', backupId });
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
  ): Promise<neverthrow.Result<void, BackupError>> {
    const metadataPath = path.join(
      this.getBackupBasePath(),
      exportFolderPath,
      'backup-metadata.json',
    );

    // ディレクトリ作成 - 失敗は予期しないエラーなのでthrow
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });

    // ファイル書き込み
    const writeResult = await neverthrow.ResultAsync.fromPromise(
      fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2)),
      (e): BackupError => ({
        type: 'METADATA_WRITE_FAILED',
        path: metadataPath,
        message: e instanceof Error ? e.message : String(e),
      }),
    );

    return writeResult;
  }
}

// デフォルトインスタンスをエクスポート
export const backupService = new BackupService();
