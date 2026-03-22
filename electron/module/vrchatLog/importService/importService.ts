import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

type NodeDirent = Dirent;

import { Effect } from 'effect';
import { match } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import { LOG_SYNC_MODE, syncLogs } from '../../logSync/service';
import {
  backupService,
  type DBLogProvider,
  type ImportBackupMetadata,
} from '../backupService/backupService';
import { appendLoglinesToFile } from '../fileHandlers/logStorageManager';
import { type VRChatLogLine, VRChatLogLineSchema } from '../model';
import {
  ImportBackupFailed,
  ImportDbSyncFailed,
  ImportFileNotFound,
  ImportNoFilesFound,
  type ImportServiceError,
} from './errors';

/**
 * @deprecated Use ImportServiceError tagged errors instead
 */
export type ImportError = ImportServiceError;

/**
 * ImportServiceError からユーザー向けメッセージを取得
 */
export const getImportErrorMessage = (error: ImportServiceError): string =>
  match(error)
    .with(
      { _tag: 'ImportNoFilesFound' },
      () => 'インポート対象のlogStoreファイルが見つかりませんでした',
    )
    .with(
      { _tag: 'ImportBackupFailed' },
      (e) => `バックアップに失敗しました: ${e.message}`,
    )
    .with(
      { _tag: 'ImportFileNotFound' },
      (e) => `ファイルが見つかりません: ${e.path}`,
    )
    .with(
      { _tag: 'ImportDbSyncFailed' },
      (e) => `DB同期に失敗しました: ${e.message}`,
    )
    .with(
      { _tag: 'ImportLogstoreIntegrationFailed' },
      (e) => `logStore統合に失敗しました: ${e.message}`,
    )
    .exhaustive();

/**
 * インポート結果
 */
export interface ImportResult {
  success: boolean;
  backup: ImportBackupMetadata;
  importedData: {
    logLines: VRChatLogLine[];
    totalLines: number;
    processedFiles: string[];
  };
}

/**
 * インポートサービス
 * logStoreファイルを既存のlogStore階層に統合し、DBに反映
 *
 * @see docs/app-event-export-import.md - エクスポート/インポート仕様
 * @see BackupService - バックアップ作成
 * @see RollbackService - ロールバック処理
 */
export class ImportService {
  /**
   * logStoreファイルまたはディレクトリをインポート
   */
  importLogStoreFiles(
    paths: string[],
    getDBLogs: DBLogProvider,
  ): Effect.Effect<ImportResult, ImportServiceError> {
    return Effect.gen(this, function* () {
      logger.info(`Starting import process for ${paths.length} paths`);

      // 1. パスからlogStoreファイルを収集（ディレクトリも対応）
      const filePaths = yield* Effect.tryPromise({
        try: () => this.collectLogStoreFiles(paths),
        catch: (e) => {
          // Unexpected errors should propagate
          throw e;
        },
      }) as Effect.Effect<string[], ImportServiceError>;

      if (filePaths.length === 0) {
        return yield* Effect.fail(new ImportNoFilesFound({ paths }));
      }

      logger.info(`Found ${filePaths.length} logStore files to import`);

      // 2. インポート前バックアップ作成（エクスポート機能活用）
      const backup = yield* backupService
        .createPreImportBackup(getDBLogs)
        .pipe(
          Effect.mapError(
            (backupError) =>
              new ImportBackupFailed({ message: backupError.message }),
          ),
        );

      // 3. バックアップにインポート情報を追加
      backup.sourceFiles = paths; // 元の指定パスを記録
      backup.importTimestamp = new Date();

      yield* backupService
        .updateBackupMetadata(backup)
        .pipe(
          Effect.mapError(
            (updateError) =>
              new ImportBackupFailed({ message: updateError.message }),
          ),
        );

      // 4. ファイル検証
      yield* Effect.tryPromise({
        try: () => this.validateLogStoreFilesInternal(filePaths),
        catch: (e) => {
          // ImportServiceError thrown from validateLogStoreFilesInternal
          if (typeof e === 'object' && e !== null && '_tag' in e) {
            return e as ImportServiceError;
          }
          // Unexpected errors should propagate
          throw e;
        },
      });

      // 5. logStoreファイル解析・統合（既存システム活用）
      const importedData = yield* this.parseAndIntegrateLogStore(filePaths);

      // 6. DB同期（既存のsyncLogs使用）
      // syncLogs returns Effect<LogSyncResults, VRChatLogFileError | LogInfoError>
      yield* syncLogs(LOG_SYNC_MODE.INCREMENTAL).pipe(
        Effect.mapError(
          (syncError) => new ImportDbSyncFailed({ message: syncError.message }),
        ),
      );

      logger.info(
        `Import completed successfully: ${importedData.totalLines} lines from ${importedData.processedFiles.length} files`,
      );

      return {
        success: true,
        backup,
        importedData,
      };
    });
  }

  /**
   * 指定されたパスからlogStoreファイルを収集（ディレクトリ再帰検索対応）
   * 予期しないエラーはthrowされる（Sentryに送信）
   */
  private async collectLogStoreFiles(paths: string[]): Promise<string[]> {
    const allFiles: string[] = [];

    for (const targetPath of paths) {
      // パスの存在確認
      const accessExists = await fs
        .access(targetPath)
        .then(() => true)
        .catch(() => false);
      if (!accessExists) {
        logger.warn(`Path not found, skipping: ${targetPath}`);
        continue;
      }

      // stat は予期しないエラーなので throw
      const stat = await fs.stat(targetPath);

      if (stat.isFile()) {
        // ファイルの場合：logStoreファイルかどうかチェック
        if (this.isLogStoreFile(targetPath)) {
          allFiles.push(targetPath);
          logger.info(`Added file: ${path.basename(targetPath)}`);
        } else {
          logger.warn(
            `Skipping non-logStore file: ${path.basename(targetPath)}`,
          );
        }
      } else if (stat.isDirectory()) {
        // ディレクトリの場合：再帰検索
        const foundFiles = await this.findLogStoreFilesInDirectory(targetPath);
        allFiles.push(...foundFiles);
        logger.info(
          `Found ${foundFiles.length} files in directory: ${path.basename(
            targetPath,
          )}`,
        );
      }
    }

    // 重複除去
    const uniqueFiles = [...new Set(allFiles)];
    logger.info(
      `Collected ${uniqueFiles.length} unique logStore files from ${paths.length} paths`,
    );

    return uniqueFiles;
  }

  /**
   * ディレクトリ内のlogStoreファイルを再帰的に検索
   * 読み取りエラーは警告ログを出力し、読めたファイルのみを返す（部分的成功パターン）
   */
  private async findLogStoreFilesInDirectory(
    dirPath: string,
  ): Promise<string[]> {
    let entries: NodeDirent[];
    try {
      entries = (await fs.readdir(dirPath, {
        withFileTypes: true,
      })) as NodeDirent[];
    } catch (error) {
      // ディレクトリ読み取り失敗は警告のみ（部分的成功を許容）
      logger.warnWithSentry({
        message: `Failed to read directory ${dirPath}: ${String(error)}`,
        details: { dirPath },
      });
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isFile()) {
        if (this.isLogStoreFile(fullPath)) {
          files.push(fullPath);
        }
      } else if (entry.isDirectory()) {
        // 再帰検索
        const subDirFiles = await this.findLogStoreFilesInDirectory(fullPath);
        files.push(...subDirFiles);
      }
    }

    return files;
  }

  /**
   * ファイルがlogStoreファイルかどうか判定
   */
  private isLogStoreFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const extension = path.extname(filePath);

    // .txt拡張子で、logStoreまたはvrchat-albums-exportを含む
    return (
      extension === '.txt' &&
      (fileName.includes('logStore') ||
        filePath.includes('vrchat-albums-export'))
    );
  }

  /**
   * logStoreファイルの形式を検証（内部実装 - Promise版）
   * 予期しないエラーはthrowされる（Sentryに送信）
   */
  private async validateLogStoreFilesInternal(
    filePaths: string[],
  ): Promise<void> {
    for (const filePath of filePaths) {
      // ファイル存在確認
      const accessExists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      if (!accessExists) {
        throw new ImportFileNotFound({ path: filePath });
      }

      // ファイル名の形式確認（logStore-YYYY-MM.txt形式）
      const fileName = path.basename(filePath);
      if (!fileName.match(/^logStore-\d{4}-\d{2}\.txt$/)) {
        logger.warn(`File name does not match expected pattern: ${fileName}`);
        // 警告として記録するが、処理は継続
      }

      // ファイル内容のサンプル検証（最初の数行をチェック）
      // readFile エラーは予期しないエラーなので throw
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').slice(0, 10); // 最初の10行をチェック

      for (const line of lines) {
        if (line.trim() === '') continue;

        const parseResult = VRChatLogLineSchema.safeParse(line);
        if (!parseResult.success) {
          logger.warn(
            `Invalid log line format in ${fileName}: ${line.substring(0, 100)}...`,
          );
          // 一部の行が無効でも処理は継続（警告のみ）
        }
      }
    }

    logger.info(`Validation completed for ${filePaths.length} files`);
  }

  /**
   * logStoreファイルを解析して既存のlogStore階層に統合
   * 予期しないエラーはthrowされる（Sentryに送信）
   */
  private parseAndIntegrateLogStore(filePaths: string[]): Effect.Effect<
    {
      logLines: VRChatLogLine[];
      totalLines: number;
      processedFiles: string[];
    },
    ImportServiceError
  > {
    return Effect.gen(this, function* () {
      const allLogLines: VRChatLogLine[] = [];
      const processedFiles: string[] = [];

      for (const filePath of filePaths) {
        logger.info(`Processing file: ${filePath}`);

        // ファイル読み込み・解析（予期しないエラーは throw）
        const content = yield* Effect.tryPromise({
          try: () => fs.readFile(filePath, 'utf-8'),
          catch: (e) => {
            throw e; // Unexpected error
          },
        }) as Effect.Effect<string, ImportServiceError>;

        const lines = content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''); // 空行を除外

        const validLogLines: VRChatLogLine[] = [];
        let invalidLineCount = 0;

        for (const line of lines) {
          const parseResult = VRChatLogLineSchema.safeParse(line);
          if (parseResult.success) {
            validLogLines.push(parseResult.data);
          } else {
            invalidLineCount++;
            // 無効な行は警告として記録し、スキップ
            logger.warn(
              `Skipping invalid log line: ${line.substring(0, 100)}...`,
            );
          }
        }

        allLogLines.push(...validLogLines);
        processedFiles.push(filePath);

        logger.info(
          `Processed ${validLogLines.length} valid lines from ${path.basename(
            filePath,
          )} (${invalidLineCount} invalid lines skipped)`,
        );
      }

      // 重複を確認（同一内容の行をカウント）
      const uniqueLines = new Map<string, number>();
      for (const logLine of allLogLines) {
        const count = uniqueLines.get(logLine) || 0;
        uniqueLines.set(logLine, count + 1);
      }

      const duplicateCount = Array.from(uniqueLines.values()).reduce(
        (sum, count) => sum + (count > 1 ? count - 1 : 0),
        0,
      );

      if (duplicateCount > 0) {
        logger.info(
          `Found ${duplicateCount} duplicate log lines (will be handled by logStorageManager)`,
        );
      }

      // 既存のlogStorageManagerを活用して統合
      // 重複除外、月別振り分け、10MB分割は自動実行
      // appendLoglinesToFile returns Effect<void, never>, so no error mapping needed
      yield* appendLoglinesToFile({
        logLines: allLogLines,
      });

      logger.info(
        `Successfully integrated ${allLogLines.length} log lines into logStore`,
      );

      return {
        logLines: allLogLines,
        totalLines: allLogLines.length,
        processedFiles,
      };
    });
  }
}

// デフォルトインスタンスをエクスポート
export const importService = new ImportService();
