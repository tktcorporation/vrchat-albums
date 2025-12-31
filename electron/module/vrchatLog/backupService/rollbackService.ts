import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as neverthrow from 'neverthrow';
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
 * ファイル/ディレクトリの存在確認
 * @returns true if exists, false if not
 */
const existsAsync = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

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

    // dbQueue.transactionは予期しないエラーをそのまま throw する
    // これによりSentryにエラーが送信される
    // QUEUE_FULL, TASK_TIMEOUT のみがResult型で返される
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
      // ファイルシステムエラーは予期しないエラーとしてthrow
      await this.clearCurrentLogStore();

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
      // DBQueueError (QUEUE_FULL, TASK_TIMEOUT) を RollbackError にマッピング
      return neverthrow.err<void, RollbackError>(
        match(transactionResult.error)
          .with({ type: 'QUEUE_FULL' }, (e) => ({
            type: 'TRANSACTION_FAILED' as const,
            message: e.message,
          }))
          .with({ type: 'TASK_TIMEOUT' }, (e) => ({
            type: 'TRANSACTION_FAILED' as const,
            message: e.message,
          }))
          .exhaustive(),
      );
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
    if (!(await existsAsync(backupPath))) {
      return neverthrow.err({ type: 'BACKUP_DIR_NOT_FOUND', path: backupPath });
    }

    // メタデータファイルの存在確認
    const metadataPath = path.join(backupPath, 'backup-metadata.json');
    if (!(await existsAsync(metadataPath))) {
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

      if (!(await existsAsync(logStoreFile))) {
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
   * ファイルシステムエラーは予期しないエラーとしてthrow（Sentryに送信）
   */
  private async clearCurrentLogStore(): Promise<void> {
    const logStoreDir = getLogStoreDir();

    // logStoreディレクトリが存在する場合は削除
    // force: true なのでディレクトリが存在しなくてもエラーにならない
    // その他のエラー（権限など）は予期しないエラーとしてthrow
    await fs.rm(logStoreDir, { recursive: true, force: true });
    logger.info(`Cleared current logStore directory: ${logStoreDir}`);

    // 新しいlogStoreディレクトリを初期化
    initLogStoreDir();
  }

  /**
   * バックアップからlogStoreを復帰
   * ファイルシステムエラーは予期しないエラーとしてthrow（Sentryに送信）
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

    // 各月別ディレクトリをコピー
    // ファイルシステムエラーは予期しないエラーとしてthrow
    for (const monthDir of monthDirs) {
      const sourceDir = path.join(backupPath, monthDir.name);
      const targetDir = path.join(currentLogStoreDir, monthDir.name);

      await fs.mkdir(targetDir, { recursive: true });
      await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
      logger.info(`Restored month directory: ${monthDir.name}`);
    }

    if (monthDirs.length === 0) {
      return neverthrow.err({ type: 'NO_DIRS_RESTORED' });
    }

    logger.info(
      `Successfully restored ${monthDirs.length} month directories from backup`,
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
