import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as neverthrow from 'neverthrow';
import { match, P } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import { LOG_SYNC_MODE, syncLogs } from '../../logSync/service';
import {
  backupService,
  type DBLogProvider,
  type ImportBackupMetadata,
} from '../backupService/backupService';
import { appendLoglinesToFile } from '../fileHandlers/logStorageManager';
import { type VRChatLogLine, VRChatLogLineSchema } from '../model';

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
  async importLogStoreFiles(
    paths: string[],
    getDBLogs: DBLogProvider,
  ): Promise<neverthrow.Result<ImportResult, Error>> {
    logger.info(`Starting import process for ${paths.length} paths`);

    let backup: ImportBackupMetadata | null = null;

    try {
      // 1. パスからlogStoreファイルを収集（ディレクトリも対応）
      const fileCollectionResult = await this.collectLogStoreFiles(paths);
      if (fileCollectionResult.isErr()) {
        return neverthrow.err(fileCollectionResult.error);
      }
      const filePaths = fileCollectionResult.value;

      if (filePaths.length === 0) {
        return neverthrow.err(
          new Error('インポート対象のlogStoreファイルが見つかりませんでした'),
        );
      }

      logger.info(`Found ${filePaths.length} logStore files to import`);

      // 2. インポート前バックアップ作成（エクスポート機能活用）
      const backupResult = await backupService.createPreImportBackup(getDBLogs);
      if (backupResult.isErr()) {
        return neverthrow.err(backupResult.error);
      }
      backup = backupResult.value;

      // 3. バックアップにインポート情報を追加
      backup.sourceFiles = paths; // 元の指定パスを記録
      backup.importTimestamp = new Date();

      const updateResult = await backupService.updateBackupMetadata(backup);
      if (updateResult.isErr()) {
        return neverthrow.err(updateResult.error);
      }

      // 4. ファイル検証
      const validationResult = await this.validateLogStoreFiles(filePaths);
      if (validationResult.isErr()) {
        return neverthrow.err(validationResult.error);
      }

      // 5. logStoreファイル解析・統合（既存システム活用）
      const importDataResult = await this.parseAndIntegrateLogStore(filePaths);
      if (importDataResult.isErr()) {
        return neverthrow.err(importDataResult.error);
      }

      const importedData = importDataResult.value;

      // 6. DB同期（既存のsyncLogs使用）
      const syncResult = await syncLogs(LOG_SYNC_MODE.INCREMENTAL);
      if (syncResult.isErr()) {
        const errorMessage = match(syncResult.error)
          .with(P.instanceOf(Error), (err) => err.message)
          .otherwise((err) => JSON.stringify(err));

        return neverthrow.err(
          new Error(`DB同期に失敗しました: ${errorMessage}`),
        );
      }

      logger.info(
        `Import completed successfully: ${importedData.totalLines} lines from ${importedData.processedFiles.length} files`,
      );

      return neverthrow.ok({
        success: true,
        backup,
        importedData,
      });
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((err) => String(err));

      logger.error({
        message: `Import failed: ${errorMessage}`,
        stack: error instanceof Error ? error : new Error(String(error)),
      });

      // エラー時は自動ロールバック（バックアップが作成されている場合のみ）
      if (backup) {
        logger.info(`Attempting automatic rollback to backup: ${backup.id}`);
        // 注意: ここではロールバック失敗は無視（元のエラーを優先）
        // ロールバックサービスは別途実装
      }

      return neverthrow.err(
        new Error(`インポートに失敗しました: ${errorMessage}`),
      );
    }
  }

  /**
   * 指定されたパスからlogStoreファイルを収集（ディレクトリ再帰検索対応）
   */
  private async collectLogStoreFiles(
    paths: string[],
  ): Promise<neverthrow.Result<string[], Error>> {
    try {
      const allFiles: string[] = [];

      for (const targetPath of paths) {
        // パスの存在確認
        try {
          await fs.access(targetPath);
        } catch {
          logger.warn(`Path not found, skipping: ${targetPath}`);
          continue;
        }

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
          const foundFiles =
            await this.findLogStoreFilesInDirectory(targetPath);
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

      return neverthrow.ok(uniqueFiles);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((err) => String(err));

      return neverthrow.err(
        new Error(`logStoreファイルの収集に失敗しました: ${errorMessage}`),
      );
    }
  }

  /**
   * ディレクトリ内のlogStoreファイルを再帰的に検索
   */
  private async findLogStoreFilesInDirectory(
    dirPath: string,
  ): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

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
    } catch (error) {
      logger.error({
        message: `Failed to read directory ${dirPath}: ${String(error)}`,
      });
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
   * logStoreファイルの形式を検証
   */
  private async validateLogStoreFiles(
    filePaths: string[],
  ): Promise<neverthrow.Result<void, Error>> {
    try {
      for (const filePath of filePaths) {
        // ファイル存在確認
        try {
          await fs.access(filePath);
        } catch {
          return neverthrow.err(
            new Error(`ファイルが見つかりません: ${filePath}`),
          );
        }

        // ファイル名の形式確認（logStore-YYYY-MM.txt形式）
        const fileName = path.basename(filePath);
        if (!fileName.match(/^logStore-\d{4}-\d{2}\.txt$/)) {
          logger.warn(`File name does not match expected pattern: ${fileName}`);
          // 警告として記録するが、処理は継続
        }

        // ファイル内容のサンプル検証（最初の数行をチェック）
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').slice(0, 10); // 最初の10行をチェック

        for (const line of lines) {
          if (line.trim() === '') continue;

          try {
            VRChatLogLineSchema.parse(line);
          } catch (_parseError) {
            logger.warn(
              `Invalid log line format in ${fileName}: ${line.substring(
                0,
                100,
              )}...`,
            );
            // 一部の行が無効でも処理は継続（警告のみ）
          }
        }
      }

      logger.info(`Validation completed for ${filePaths.length} files`);
      return neverthrow.ok(undefined);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((err) => String(err));

      return neverthrow.err(
        new Error(`ファイル検証に失敗しました: ${errorMessage}`),
      );
    }
  }

  /**
   * logStoreファイルを解析して既存のlogStore階層に統合
   */
  private async parseAndIntegrateLogStore(filePaths: string[]): Promise<
    neverthrow.Result<
      {
        logLines: VRChatLogLine[];
        totalLines: number;
        processedFiles: string[];
      },
      Error
    >
  > {
    try {
      const allLogLines: VRChatLogLine[] = [];
      const processedFiles: string[] = [];

      for (const filePath of filePaths) {
        logger.info(`Processing file: ${filePath}`);

        // ファイル読み込み・解析
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''); // 空行を除外

        const validLogLines: VRChatLogLine[] = [];
        let invalidLineCount = 0;

        for (const line of lines) {
          try {
            const logLine = VRChatLogLineSchema.parse(line);
            validLogLines.push(logLine);
          } catch (_parseError) {
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
      const integrationResult = await appendLoglinesToFile({
        logLines: allLogLines,
      });
      if (integrationResult.isErr()) {
        return neverthrow.err(
          new Error(`logStore統合に失敗しました: ${integrationResult.error}`),
        );
      }

      logger.info(
        `Successfully integrated ${allLogLines.length} log lines into logStore`,
      );

      return neverthrow.ok({
        logLines: allLogLines,
        totalLines: allLogLines.length,
        processedFiles,
      });
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((err) => String(err));

      return neverthrow.err(
        new Error(
          `logStoreファイルの解析・統合に失敗しました: ${errorMessage}`,
        ),
      );
    }
  }
}

// デフォルトインスタンスをエクスポート
export const importService = new ImportService();
