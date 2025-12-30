import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { getDBQueue } from '../../../lib/dbQueue';
import { logger } from '../../../lib/logger';

/**
 * ロールバック処理のエラー型
 * 呼び出し側でパターンマッチングできるように具体的な型を定義
 * 予期しないエラーはthrowしてSentryに送信（ここには含めない）
 */
export type RollbackError =
  | { type: 'BACKUP_DIR_NOT_FOUND'; path: string }
  | { type: 'METADATA_NOT_FOUND'; path: string }
  | { type: 'NO_VALID_MONTH_DATA'; path: string }
  | { type: 'VALIDATION_FAILED'; message: string }
  | { type: 'CLEAR_LOGSTORE_FAILED'; message: string }
  | { type: 'RESTORE_FAILED'; message: string }
  | { type: 'NO_DIRS_RESTORED' }
  | { type: 'DB_REBUILD_FAILED'; message: string }
  | { type: 'TRANSACTION_FAILED'; message: string };

/**
 * RollbackError からユーザー向けメッセージを取得
 */
export const getRollbackErrorMessage = (error: RollbackError): string =>
  match(error)
    .with(
      { type: 'BACKUP_DIR_NOT_FOUND' },
      (e) => `バックアップディレクトリが見つかりません: ${e.path}`,
    )
    .with(
      { type: 'METADATA_NOT_FOUND' },
      (e) => `メタデータファイルが見つかりません: ${e.path}`,
    )
    .with(
      { type: 'NO_VALID_MONTH_DATA' },
      (e) => `有効な月別データが見つかりません: ${e.path}`,
    )
    .with(
      { type: 'VALIDATION_FAILED' },
      (e) => `検証に失敗しました: ${e.message}`,
    )
    .with(
      { type: 'CLEAR_LOGSTORE_FAILED' },
      (e) => `logStoreのクリアに失敗しました: ${e.message}`,
    )
    .with({ type: 'RESTORE_FAILED' }, (e) => `復帰に失敗しました: ${e.message}`)
    .with(
      { type: 'NO_DIRS_RESTORED' },
      () => 'バックアップからディレクトリを復帰できませんでした',
    )
    .with(
      { type: 'DB_REBUILD_FAILED' },
      (e) => `DB再構築に失敗しました: ${e.message}`,
    )
    .with(
      { type: 'TRANSACTION_FAILED' },
      (e) => `トランザクションに失敗しました: ${e.message}`,
    )
    .exhaustive();

/**
 * ファイル/ディレクトリの存在確認をResultAsyncでラップ
 */
const accessAsync = (
  targetPath: string,
): ResultAsync<void, { code: string; path: string }> =>
  ResultAsync.fromPromise(fs.access(targetPath), (error) => ({
    code:
      error instanceof Error && 'code' in error
        ? String(error.code)
        : 'UNKNOWN',
    path: targetPath,
  }));

/**
 * ディレクトリを再帰的に削除（存在しない場合は成功扱い）
 */
const rmDirAsync = (dirPath: string): ResultAsync<void, Error> =>
  ResultAsync.fromPromise(
    fs.rm(dirPath, { recursive: true, force: true }),
    (e): Error => (e instanceof Error ? e : new Error(String(e))),
  );

/**
 * ディレクトリをコピー
 */
const copyDirAsync = (
  source: string,
  target: string,
): ResultAsync<void, Error> =>
  ResultAsync.fromPromise(
    (async () => {
      await fs.mkdir(target, { recursive: true });
      await fs.cp(source, target, { recursive: true, force: true });
    })(),
    (e): Error => (e instanceof Error ? e : new Error(String(e))),
  );

import { LOG_SYNC_MODE, syncLogs } from '../../logSync/service';
import {
  getLogStoreDir,
  initLogStoreDir,
} from '../fileHandlers/logStorageManager';
import {
  backupService,
  getBackupErrorMessage,
  type ImportBackupMetadata,
} from './backupService';

/**
 * ロールバックサービス
 * バックアップからlogStoreとDBを復帰
 *
 * @see docs/app-event-export-import.md - エクスポート/インポート仕様
 * @see BackupService - バックアップ作成
 * @see ImportService - インポート処理
 */
export class RollbackService {
  /**
   * 指定されたバックアップにロールバック
   */
  async rollbackToBackup(
    backup: ImportBackupMetadata,
  ): Promise<neverthrow.Result<void, RollbackError>> {
    logger.info(`Starting rollback to backup: ${backup.id}`);

    const dbQueue = getDBQueue();

    // dbQueue.transactionは予期しないエラーを自動的にキャッチして
    // Result<T, DBQueueError>として返すため、内部でtry-catchは不要
    const transactionResult = await dbQueue.transaction(async () => {
      const backupPath = path.join(
        backupService.getBackupBasePath(),
        backup.exportFolderPath,
      );

      // 1. バックアップデータの存在確認
      const validationResult = await this.validateBackupData(backupPath);
      if (validationResult.isErr()) {
        return neverthrow.err(validationResult.error);
      }

      // 2. 現在のlogStoreをクリア
      const clearResult = await this.clearCurrentLogStore();
      if (clearResult.isErr()) {
        return neverthrow.err(clearResult.error);
      }

      // 3. バックアップからlogStore復帰
      const restoreResult = await this.restoreLogStoreFromBackup(backupPath);
      if (restoreResult.isErr()) {
        return neverthrow.err(restoreResult.error);
      }

      // 4. DBを再構築（復帰したlogStoreから）
      const rebuildResult = await this.rebuildDatabaseFromLogStore();
      if (rebuildResult.isErr()) {
        return neverthrow.err(rebuildResult.error);
      }

      // 5. バックアップ状態更新
      backup.status = 'rolled_back';
      const updateResult = await backupService.updateBackupMetadata(backup);
      if (updateResult.isErr()) {
        logger.warn(
          `Failed to update backup metadata after rollback: ${getBackupErrorMessage(updateResult.error)}`,
        );
        // ロールバック自体は成功しているので警告のみ
      }

      logger.info(`Rollback completed successfully: ${backup.id}`);
      return neverthrow.ok(undefined);
    });

    if (transactionResult.isErr()) {
      return neverthrow.err<void, RollbackError>({
        type: 'TRANSACTION_FAILED',
        message: transactionResult.error.message,
      });
    }

    return transactionResult.value;
  }

  /**
   * バックアップデータの存在と整合性を確認
   */
  private async validateBackupData(
    backupPath: string,
  ): Promise<neverthrow.Result<void, RollbackError>> {
    // バックアップディレクトリの存在確認
    const backupDirResult = await accessAsync(backupPath);
    if (backupDirResult.isErr()) {
      return neverthrow.err({ type: 'BACKUP_DIR_NOT_FOUND', path: backupPath });
    }

    // メタデータファイルの存在確認
    const metadataPath = path.join(backupPath, 'backup-metadata.json');
    const metadataResult = await accessAsync(metadataPath);
    if (metadataResult.isErr()) {
      return neverthrow.err({ type: 'METADATA_NOT_FOUND', path: metadataPath });
    }

    // 月別ディレクトリの存在確認
    // readdir失敗は予期しないエラーなのでthrow
    const entries = await fs.readdir(backupPath, { withFileTypes: true });
    const monthDirs = entries.filter(
      (entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name),
    );

    if (monthDirs.length === 0) {
      return neverthrow.err({ type: 'NO_VALID_MONTH_DATA', path: backupPath });
    }

    // 各月別ディレクトリ内のlogStoreファイル確認
    for (const monthDir of monthDirs) {
      const monthPath = path.join(backupPath, monthDir.name);
      const logStoreFile = path.join(
        monthPath,
        `logStore-${monthDir.name}.txt`,
      );

      const logStoreResult = await accessAsync(logStoreFile);
      if (logStoreResult.isErr()) {
        logger.warn(`logStore file not found: ${logStoreFile}`);
        // 一部のファイルが見つからなくても継続（警告のみ）
      }
    }

    logger.info(
      `Backup validation completed: ${monthDirs.length} month directories found`,
    );
    return neverthrow.ok(undefined);
  }

  /**
   * 現在のlogStoreディレクトリをクリア
   */
  private async clearCurrentLogStore(): Promise<
    neverthrow.Result<void, RollbackError>
  > {
    const logStoreDir = getLogStoreDir();

    // logStoreディレクトリが存在する場合は削除
    const accessResult = await accessAsync(logStoreDir);
    if (accessResult.isOk()) {
      const rmResult = await rmDirAsync(logStoreDir);
      if (rmResult.isErr()) {
        return neverthrow.err({
          type: 'CLEAR_LOGSTORE_FAILED',
          message: rmResult.error.message,
        });
      }
      logger.info(`Cleared current logStore directory: ${logStoreDir}`);
    } else {
      // ディレクトリが存在しない場合は何もしない
      logger.info(`logStore directory does not exist: ${logStoreDir}`);
    }

    // 新しいlogStoreディレクトリを初期化
    initLogStoreDir();
    return neverthrow.ok(undefined);
  }

  /**
   * バックアップからlogStoreを復帰
   */
  private async restoreLogStoreFromBackup(
    backupPath: string,
  ): Promise<neverthrow.Result<void, RollbackError>> {
    const currentLogStoreDir = getLogStoreDir();

    // バックアップ内の月別フォルダを現在のlogStoreに復帰
    // readdir失敗は予期しないエラーなのでthrow
    const backupEntries = await fs.readdir(backupPath, { withFileTypes: true });
    const monthDirs = backupEntries.filter(
      (entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name),
    );

    let restoredDirCount = 0;

    for (const monthDir of monthDirs) {
      const sourceDir = path.join(backupPath, monthDir.name);
      const targetDir = path.join(currentLogStoreDir, monthDir.name);

      const copyResult = await copyDirAsync(sourceDir, targetDir);
      if (copyResult.isErr()) {
        logger.error({
          message: `Failed to restore month directory ${monthDir.name}: ${copyResult.error.message}`,
        });
        // 一部のディレクトリの復帰に失敗しても継続
      } else {
        restoredDirCount++;
        logger.info(`Restored month directory: ${monthDir.name}`);
      }
    }

    if (restoredDirCount === 0) {
      return neverthrow.err({ type: 'NO_DIRS_RESTORED' });
    }

    logger.info(
      `Successfully restored ${restoredDirCount} month directories from backup`,
    );
    return neverthrow.ok(undefined);
  }

  /**
   * 復帰したlogStoreからDBを完全再構築
   * 予期しないエラーは上位のtry-catchでSentryに送信される
   */
  private async rebuildDatabaseFromLogStore(): Promise<
    neverthrow.Result<void, RollbackError>
  > {
    logger.info('Starting database rebuild from restored logStore');

    // 復帰したlogStoreからDBを完全再構築
    const syncResult = await syncLogs(LOG_SYNC_MODE.FULL);
    if (syncResult.isErr()) {
      return neverthrow.err({
        type: 'DB_REBUILD_FAILED',
        message: syncResult.error.message,
      });
    }

    logger.info('Database rebuild completed successfully');
    return neverthrow.ok(undefined);
  }
}

// デフォルトインスタンスをエクスポート
export const rollbackService = new RollbackService();
