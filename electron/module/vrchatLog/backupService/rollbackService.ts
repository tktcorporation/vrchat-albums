import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as neverthrow from 'neverthrow';
import { match, P } from 'ts-pattern';
import { getDBQueue } from '../../../lib/dbQueue';
import { logger } from '../../../lib/logger';
import { LOG_SYNC_MODE, syncLogs } from '../../logSync/service';
import {
  getLogStoreDir,
  initLogStoreDir,
} from '../fileHandlers/logStorageManager';
import { backupService, type ImportBackupMetadata } from './backupService';

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
  ): Promise<neverthrow.Result<void, Error>> {
    logger.info(`Starting rollback to backup: ${backup.id}`);

    const dbQueue = getDBQueue();

    const transactionResult = await dbQueue.transaction(async () => {
      try {
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
            `Failed to update backup metadata after rollback: ${updateResult.error.message}`,
          );
          // ロールバック自体は成功しているので警告のみ
        }

        logger.info(`Rollback completed successfully: ${backup.id}`);
        return neverthrow.ok(undefined);
      } catch (error) {
        const errorMessage = match(error)
          .with(P.instanceOf(Error), (err) => err.message)
          .otherwise((_err) => String(error));

        logger.error({
          message: `Rollback failed: ${errorMessage}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });

        return neverthrow.err(
          new Error(`ロールバックに失敗しました: ${errorMessage}`),
        );
      }
    });

    if (transactionResult.isErr()) {
      return neverthrow.err(
        new Error(
          `ロールバックトランザクションに失敗しました: ${transactionResult.error.message}`,
        ),
      );
    }

    return transactionResult.value;
  }

  /**
   * バックアップデータの存在と整合性を確認
   */
  private async validateBackupData(
    backupPath: string,
  ): Promise<neverthrow.Result<void, Error>> {
    try {
      // バックアップディレクトリの存在確認
      try {
        await fs.access(backupPath);
      } catch {
        return neverthrow.err(
          new Error(`バックアップディレクトリが見つかりません: ${backupPath}`),
        );
      }

      // メタデータファイルの存在確認
      const metadataPath = path.join(backupPath, 'backup-metadata.json');
      try {
        await fs.access(metadataPath);
      } catch {
        return neverthrow.err(
          new Error(
            `バックアップメタデータファイルが見つかりません: ${metadataPath}`,
          ),
        );
      }

      // 月別ディレクトリの存在確認
      const entries = await fs.readdir(backupPath, { withFileTypes: true });
      const monthDirs = entries.filter(
        (entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name),
      );

      if (monthDirs.length === 0) {
        return neverthrow.err(
          new Error(
            `バックアップに有効な月別データが見つかりません: ${backupPath}`,
          ),
        );
      }

      // 各月別ディレクトリ内のlogStoreファイル確認
      for (const monthDir of monthDirs) {
        const monthPath = path.join(backupPath, monthDir.name);
        const logStoreFile = path.join(
          monthPath,
          `logStore-${monthDir.name}.txt`,
        );

        try {
          await fs.access(logStoreFile);
        } catch {
          logger.warn(`logStore file not found: ${logStoreFile}`);
          // 一部のファイルが見つからなくても継続（警告のみ）
        }
      }

      logger.info(
        `Backup validation completed: ${monthDirs.length} month directories found`,
      );
      return neverthrow.ok(undefined);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((_err) => String(error));

      return neverthrow.err(
        new Error(`バックアップデータの検証に失敗しました: ${errorMessage}`),
      );
    }
  }

  /**
   * 現在のlogStoreディレクトリをクリア
   */
  private async clearCurrentLogStore(): Promise<void> {
    const logStoreDir = getLogStoreDir();

    try {
      // logStoreディレクトリが存在する場合は削除
      try {
        await fs.access(logStoreDir);
        await fs.rm(logStoreDir, { recursive: true, force: true });
        logger.info(`Cleared current logStore directory: ${logStoreDir}`);
      } catch {
        // ディレクトリが存在しない場合は何もしない
        logger.info(`logStore directory does not exist: ${logStoreDir}`);
      }

      // 新しいlogStoreディレクトリを初期化
      initLogStoreDir();
    } catch (error) {
      throw new Error(
        `現在のlogStoreディレクトリのクリアに失敗しました: ${String(error)}`,
      );
    }
  }

  /**
   * バックアップからlogStoreを復帰
   */
  private async restoreLogStoreFromBackup(
    backupPath: string,
  ): Promise<neverthrow.Result<void, Error>> {
    try {
      const currentLogStoreDir = getLogStoreDir();

      // バックアップ内の月別フォルダを現在のlogStoreに復帰
      const backupEntries = await fs.readdir(backupPath, {
        withFileTypes: true,
      });
      const monthDirs = backupEntries.filter(
        (entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name),
      );

      let restoredDirCount = 0;

      for (const monthDir of monthDirs) {
        const sourceDir = path.join(backupPath, monthDir.name);
        const targetDir = path.join(currentLogStoreDir, monthDir.name);

        try {
          // ターゲットディレクトリを作成
          await fs.mkdir(targetDir, { recursive: true });

          // ディレクトリの内容をコピー
          await fs.cp(sourceDir, targetDir, {
            recursive: true,
            force: true, // 既存ファイルを上書き
          });

          restoredDirCount++;
          logger.info(`Restored month directory: ${monthDir.name}`);
        } catch (error) {
          logger.error({
            message: `Failed to restore month directory ${
              monthDir.name
            }: ${String(error)}`,
          });
          // 一部のディレクトリの復帰に失敗しても継続
        }
      }

      if (restoredDirCount === 0) {
        return neverthrow.err(
          new Error('バックアップからディレクトリを復帰できませんでした'),
        );
      }

      logger.info(
        `Successfully restored ${restoredDirCount} month directories from backup`,
      );
      return neverthrow.ok(undefined);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((_err) => String(error));

      return neverthrow.err(
        new Error(`logStoreの復帰に失敗しました: ${errorMessage}`),
      );
    }
  }

  /**
   * 復帰したlogStoreからDBを完全再構築
   */
  private async rebuildDatabaseFromLogStore(): Promise<
    neverthrow.Result<void, Error>
  > {
    try {
      logger.info('Starting database rebuild from restored logStore');

      // 復帰したlogStoreからDBを完全再構築
      const syncResult = await syncLogs(LOG_SYNC_MODE.FULL);
      if (syncResult.isErr()) {
        return neverthrow.err(
          new Error(`DB再構築に失敗しました: ${syncResult.error.message}`),
        );
      }

      logger.info('Database rebuild completed successfully');
      return neverthrow.ok(undefined);
    } catch (error) {
      const errorMessage = match(error)
        .with(P.instanceOf(Error), (err) => err.message)
        .otherwise((_err) => String(error));

      return neverthrow.err(
        new Error(`DB再構築に失敗しました: ${errorMessage}`),
      );
    }
  }
}

// デフォルトインスタンスをエクスポート
export const rollbackService = new RollbackService();
