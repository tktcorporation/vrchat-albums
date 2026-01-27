import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as neverthrow from 'neverthrow';
import { match } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import { LOG_SYNC_MODE, syncLogs } from '../../logSync/service';
import {
  type BackupError,
  backupService,
  getBackupErrorMessage,
  type ImportBackupMetadata,
} from '../backupService/backupService';
import type { ExportManifest } from '../exportService/exportService';
import { appendLoglinesToFile } from '../fileHandlers/logStorageManager';
import { type VRChatLogLine, VRChatLogLineSchema } from '../model';

/**
 * インポートエラー型
 * 呼び出し側でパターンマッチできるように具体的な型を定義
 * 予期しないエラーはthrowしてSentryに送信（ここには含めない）
 */
export type ImportError =
  | { type: 'NO_FILES_FOUND'; paths: string[] }
  | { type: 'BACKUP_FAILED'; error: BackupError }
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'DB_SYNC_FAILED'; message: string }
  | { type: 'LOGSTORE_INTEGRATION_FAILED'; message: string };

/**
 * ImportError からユーザー向けメッセージを取得
 */
export const getImportErrorMessage = (error: ImportError): string =>
  match(error)
    .with(
      { type: 'NO_FILES_FOUND' },
      () => 'インポート対象のlogStoreファイルが見つかりませんでした',
    )
    .with({ type: 'BACKUP_FAILED' }, (e) => getBackupErrorMessage(e.error))
    .with(
      { type: 'FILE_NOT_FOUND' },
      (e) => `ファイルが見つかりません: ${e.path}`,
    )
    .with(
      { type: 'DB_SYNC_FAILED' },
      (e) => `DB同期に失敗しました: ${e.message}`,
    )
    .with(
      { type: 'LOGSTORE_INTEGRATION_FAILED' },
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
  async importLogStoreFiles(
    paths: string[],
  ): Promise<neverthrow.Result<ImportResult, ImportError>> {
    logger.info(`Starting import process for ${paths.length} paths`);

    // 1. パスからlogStoreファイルを収集（ディレクトリも対応）
    const filePaths = await this.collectLogStoreFiles(paths);

    if (filePaths.length === 0) {
      return neverthrow.err({ type: 'NO_FILES_FOUND', paths });
    }

    logger.info(`Found ${filePaths.length} logStore files to import`);

    // 2. インポート前バックアップ作成（エクスポート機能活用）
    const backupResult = await backupService.createPreImportBackup();
    if (backupResult.isErr()) {
      return neverthrow.err({
        type: 'BACKUP_FAILED',
        error: backupResult.error,
      });
    }
    const backup = backupResult.value;

    // 3. バックアップにインポート情報を追加
    backup.sourceFiles = paths; // 元の指定パスを記録
    backup.importTimestamp = new Date();

    const updateResult = await backupService.updateBackupMetadata(backup);
    if (updateResult.isErr()) {
      return neverthrow.err({
        type: 'BACKUP_FAILED',
        error: updateResult.error,
      });
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
      return neverthrow.err({
        type: 'DB_SYNC_FAILED',
        message: syncResult.error.message,
      });
    }

    logger.info(
      `Import completed successfully: ${importedData.totalLines} lines from ${importedData.processedFiles.length} files`,
    );

    return neverthrow.ok({
      success: true,
      backup,
      importedData,
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
      const accessResult = await neverthrow.ResultAsync.fromPromise(
        fs.access(targetPath),
        () => 'NOT_FOUND' as const,
      );
      if (accessResult.isErr()) {
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
        // ディレクトリの場合：マニフェスト検証 + 再帰検索
        await this.verifyExportManifest(targetPath);
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
    const readResult = await neverthrow.ResultAsync.fromPromise(
      fs.readdir(dirPath, { withFileTypes: true }),
      (error) => error,
    );

    if (readResult.isErr()) {
      // ディレクトリ読み取り失敗は警告のみ（部分的成功を許容）
      logger.warn({
        message: `Failed to read directory ${dirPath}: ${String(readResult.error)}`,
      });
      return [];
    }

    const files: string[] = [];
    for (const entry of readResult.value) {
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
   * export-manifest.json が存在する場合、ファイル一覧と照合して検証
   * マニフェストがない場合は何もしない（後方互換性）
   */
  private async verifyExportManifest(dirPath: string): Promise<void> {
    const manifestPath = path.join(dirPath, 'export-manifest.json');

    const accessResult = await neverthrow.ResultAsync.fromPromise(
      fs.access(manifestPath),
      () => 'NOT_FOUND' as const,
    );
    if (accessResult.isErr()) {
      // マニフェストなし → 従来通り動作
      return;
    }

    const readResult = await neverthrow.ResultAsync.fromPromise(
      fs.readFile(manifestPath, 'utf-8'),
      () => 'READ_FAILED' as const,
    );
    if (readResult.isErr()) {
      logger.warn(`Failed to read export manifest: ${manifestPath}`);
      return;
    }

    const parseResult = neverthrow.fromThrowable(
      (s: string) => JSON.parse(s) as ExportManifest,
      () => 'PARSE_FAILED' as const,
    )(readResult.value);
    if (parseResult.isErr()) {
      logger.warn(`Failed to parse export manifest: ${manifestPath}`);
      return;
    }

    const manifest = parseResult.value;

    if (manifest.status !== 'completed') {
      logger.warn(
        `Export manifest indicates incomplete export: status=${String(manifest.status)}`,
      );
    }

    // マニフェスト内のファイル一覧と実際のファイルを照合
    for (const file of manifest.files) {
      const filePath = path.join(dirPath, file.relativePath);
      const fileAccessResult = await neverthrow.ResultAsync.fromPromise(
        fs.stat(filePath),
        () => 'NOT_FOUND' as const,
      );

      if (fileAccessResult.isErr()) {
        logger.warn(
          `Manifest file missing: ${file.relativePath} (expected in export)`,
        );
        continue;
      }

      const fileStat = fileAccessResult.value;
      if (fileStat.size !== file.sizeBytes) {
        logger.warn(
          `Manifest file size mismatch: ${file.relativePath} (expected: ${file.sizeBytes}, actual: ${fileStat.size})`,
        );
      }
    }

    logger.info(
      `Export manifest verified: ${manifest.files.length} files, ${manifest.totalLogLines} lines`,
    );
  }

  /**
   * logStoreファイルの形式を検証
   * 予期しないエラーはthrowされる（Sentryに送信）
   */
  private async validateLogStoreFiles(
    filePaths: string[],
  ): Promise<neverthrow.Result<void, ImportError>> {
    for (const filePath of filePaths) {
      // ファイル存在確認
      const accessResult = await neverthrow.ResultAsync.fromPromise(
        fs.access(filePath),
        () => 'NOT_FOUND' as const,
      );
      if (accessResult.isErr()) {
        return neverthrow.err({ type: 'FILE_NOT_FOUND', path: filePath });
      }

      // ファイル名の形式確認（logStore-YYYY-MM.txt形式）
      const fileName = path.basename(filePath);
      if (!fileName.match(/^logStore(-\d{4}-\d{2}(-\d{14})?)?\.txt$/)) {
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
    return neverthrow.ok(undefined);
  }

  /**
   * logStoreファイルを解析して既存のlogStore階層に統合
   * 予期しないエラーはthrowされる（Sentryに送信）
   */
  private async parseAndIntegrateLogStore(filePaths: string[]): Promise<
    neverthrow.Result<
      {
        logLines: VRChatLogLine[];
        totalLines: number;
        processedFiles: string[];
      },
      ImportError
    >
  > {
    const allLogLines: VRChatLogLine[] = [];
    const processedFiles: string[] = [];

    for (const filePath of filePaths) {
      logger.info(`Processing file: ${filePath}`);

      // ファイル読み込み・解析（予期しないエラーは throw）
      const content = await fs.readFile(filePath, 'utf-8');
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
    const integrationResult = await appendLoglinesToFile({
      logLines: allLogLines,
    });
    if (integrationResult.isErr()) {
      return neverthrow.err({
        type: 'LOGSTORE_INTEGRATION_FAILED',
        message: String(integrationResult.error),
      });
    }

    logger.info(
      `Successfully integrated ${allLogLines.length} log lines into logStore`,
    );

    return neverthrow.ok({
      logLines: allLogLines,
      totalLines: allLogLines.length,
      processedFiles,
    });
  }
}

// デフォルトインスタンスをエクスポート
export const importService = new ImportService();
