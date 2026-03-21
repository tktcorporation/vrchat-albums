import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

type NodeDirent = Dirent;

import * as datefns from 'date-fns';
import { Effect } from 'effect';
import { match } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import {
  BackupPathObjectSchema,
  type ExportPathObject,
  ExportPathObjectSchema,
} from '../../../lib/pathObject';
import { getAppUserDataPath } from '../../../lib/wrappedApp';
import type { LogRecord } from '../converters/dbToLogStore';
import {
  exportLogStoreFromDB,
  getExportErrorMessage,
} from '../exportService/exportService';
import {
  BackupExportFailed,
  BackupMetadataUpdateFailed,
  BackupMetadataWriteFailed,
  BackupNotFound,
  type BackupServiceError,
} from './errors';

/**
 * @deprecated Use BackupServiceError tagged errors instead
 */
export type BackupError = BackupServiceError;

/**
 * BackupServiceError からユーザー向けメッセージを取得
 */
export const getBackupErrorMessage = (error: BackupServiceError): string =>
  match(error)
    .with(
      { _tag: 'BackupExportFailed' },
      (e) => `バックアップ作成に失敗しました: ${e.message}`,
    )
    .with(
      { _tag: 'BackupMetadataWriteFailed' },
      (e) => `メタデータの保存に失敗しました (${e.path}): ${e.message}`,
    )
    .with(
      { _tag: 'BackupMetadataUpdateFailed' },
      (e) =>
        `バックアップメタデータの更新に失敗しました (${e.backupId}): ${e.message}`,
    )
    .with(
      { _tag: 'BackupHistoryReadFailed' },
      (e) => `バックアップ履歴の取得に失敗しました: ${e.message}`,
    )
    .with(
      { _tag: 'BackupNotFound' },
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
  createPreImportBackup(
    getDBLogs: DBLogProvider,
  ): Effect.Effect<ImportBackupMetadata, BackupServiceError> {
    return Effect.gen(this, function* () {
      const backupTimestamp = new Date();

      logger.info('Creating pre-import backup using export functionality');

      // 1. 既存エクスポート機能で全データエクスポート
      const exportResult = yield* exportLogStoreFromDB(
        {
          // 全期間エクスポート（startDate/endDate指定なし）
          outputBasePath: this.getBackupBasePath(),
        },
        getDBLogs,
      ).pipe(
        Effect.mapError(
          (exportError) =>
            new BackupExportFailed({
              message: getExportErrorMessage(exportError),
            }),
        ),
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
        return metadata;
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
      yield* this.saveBackupMetadata(exportFolderPath, metadata);

      logger.info(
        `Pre-import backup created successfully: ${backupId}, files: ${exportResult.exportedFiles.length}`,
      );

      return metadata;
    });
  }

  /**
   * バックアップメタデータを更新
   */
  updateBackupMetadata(
    metadata: ImportBackupMetadata,
  ): Effect.Effect<void, BackupServiceError> {
    return this.saveBackupMetadata(metadata.exportFolderPath, metadata).pipe(
      Effect.mapError(
        (saveError) =>
          new BackupMetadataUpdateFailed({
            backupId: metadata.id,
            message: getBackupErrorMessage(saveError),
          }),
      ),
      Effect.tap(() => {
        logger.info(`Backup metadata updated: ${metadata.id}`);
        return Effect.succeed(undefined);
      }),
    );
  }

  /**
   * バックアップ履歴を取得
   */
  getBackupHistory(): Effect.Effect<
    ImportBackupMetadata[],
    BackupServiceError
  > {
    return Effect.gen(this, function* () {
      const backupBasePath = this.getBackupBasePath();

      // バックアップディレクトリが存在しない場合は空配列を返す
      const accessExists = yield* Effect.tryPromise({
        try: () =>
          fs
            .access(backupBasePath)
            .then(() => true)
            .catch(() => false),
        catch: () => {
          // This should never happen since the promise catches internally
          throw new Error('Unexpected error checking backup directory access');
        },
      }) as Effect.Effect<boolean, BackupServiceError>;
      if (!accessExists) {
        return [];
      }

      // ディレクトリ一覧取得 - 失敗は予期しないエラーなのでthrow
      const entries = yield* Effect.tryPromise({
        try: () => fs.readdir(backupBasePath, { withFileTypes: true }),
        catch: (e) => {
          throw e; // Unexpected error
        },
      }) as Effect.Effect<NodeDirent[], BackupServiceError>;

      const backupFolders = entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith('vrchat-albums-export_'),
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
        const readExit = yield* Effect.tryPromise({
          try: () => fs.readFile(metadataPath, 'utf-8'),
          catch: (e) => e,
        }).pipe(Effect.either);

        if (readExit._tag === 'Left') {
          logger.warn(
            `Failed to read backup metadata for ${folderName}: ${String(readExit.left)}`,
          );
          continue;
        }

        const metadata = JSON.parse(readExit.right) as ImportBackupMetadata;
        // Date オブジェクトに変換
        metadata.backupTimestamp = new Date(metadata.backupTimestamp);
        metadata.importTimestamp = new Date(metadata.importTimestamp);
        backups.push(metadata);
      }

      // 作成日時で降順ソート（新しいものが先頭）
      backups.sort((a, b) =>
        datefns.compareDesc(a.backupTimestamp, b.backupTimestamp),
      );

      return backups;
    });
  }

  /**
   * 指定されたIDのバックアップを取得
   */
  getBackup(
    backupId: string,
  ): Effect.Effect<ImportBackupMetadata, BackupServiceError> {
    return Effect.gen(this, function* () {
      const history = yield* this.getBackupHistory();

      const backup = history.find((b) => b.id === backupId);
      if (!backup) {
        return yield* Effect.fail(new BackupNotFound({ backupId }));
      }

      return backup;
    });
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
  private saveBackupMetadata(
    exportFolderPath: string,
    metadata: ImportBackupMetadata,
  ): Effect.Effect<void, BackupServiceError> {
    const metadataPath = path.join(
      this.getBackupBasePath(),
      exportFolderPath,
      'backup-metadata.json',
    );

    return Effect.gen(function* () {
      // ディレクトリ作成 - 失敗は予期しないエラーなのでthrow
      yield* Effect.tryPromise({
        try: () => fs.mkdir(path.dirname(metadataPath), { recursive: true }),
        catch: (e) => {
          throw e; // Unexpected error
        },
      }) as Effect.Effect<unknown, BackupServiceError>;

      // ファイル書き込み
      yield* Effect.tryPromise({
        try: () =>
          fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2)),
        catch: (e) =>
          new BackupMetadataWriteFailed({
            path: metadataPath,
            message: e instanceof Error ? e.message : String(e),
          }),
      });
    });
  }
}

// デフォルトインスタンスをエクスポート
export const backupService = new BackupService();
