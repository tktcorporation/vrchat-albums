import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

type NodeDirent = Dirent;

import { Effect } from 'effect';
import { match } from 'ts-pattern';

import { logger } from '../../../lib/logger';
import {
  RollbackBackupDirNotFound,
  RollbackDbRebuildFailed,
  RollbackMetadataNotFound,
  RollbackNoDirsRestored,
  RollbackNoValidMonthData,
  type RollbackServiceError,
} from './errors';

/**
 * RollbackServiceError からユーザー向けメッセージを取得
 */
export const getRollbackErrorMessage = (error: RollbackServiceError): string =>
  match(error)
    .with(
      { _tag: 'RollbackBackupDirNotFound' },
      (e) => `バックアップディレクトリが見つかりません: ${e.path}`,
    )
    .with(
      { _tag: 'RollbackMetadataNotFound' },
      (e) => `メタデータファイルが見つかりません: ${e.path}`,
    )
    .with(
      { _tag: 'RollbackNoValidMonthData' },
      (e) => `有効な月別データが見つかりません: ${e.path}`,
    )
    .with(
      { _tag: 'RollbackValidationFailed' },
      (e) => `検証に失敗しました: ${e.message}`,
    )
    .with(
      { _tag: 'RollbackRestoreFailed' },
      (e) => `復帰に失敗しました: ${e.message}`,
    )
    .with(
      { _tag: 'RollbackNoDirsRestored' },
      () => 'バックアップからディレクトリを復帰できませんでした',
    )
    .with(
      { _tag: 'RollbackDbRebuildFailed' },
      (e) => `DB再構築に失敗しました: ${e.message}`,
    )
    .exhaustive();

/**
 * ファイル/ディレクトリの存在確認
 * fs.statを使用してtry-catchを避ける
 * @returns true if exists, false if not
 */
const existsAsync = async (targetPath: string): Promise<boolean> => {
  const stat = await fs.stat(targetPath).catch(() => null);
  return stat !== null;
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
  rollbackToBackup(
    backup: ImportBackupMetadata,
  ): Effect.Effect<void, RollbackServiceError> {
    return Effect.gen({ self: this }, function* () {
      logger.info(`Starting rollback to backup: ${backup.id}`);

      const backupPath = path.join(
        backupService.getBackupBasePath(),
        backup.exportFolderPath,
      );

      // logStore の入れ替えはファイルの操作だけなので、DB のトランザクションの外で行う。
      // DB の再構築は、ログ同期（syncLogs）がログの一括登録を自分のトランザクションで書き込む
      yield* this.validateBackupData(backupPath);

      // ファイルシステムエラーは予期しないエラーとしてthrow
      yield* Effect.promise(() => this.clearCurrentLogStore());

      yield* this.restoreLogStoreFromBackup(backupPath);

      yield* this.rebuildDatabaseFromLogStore();

      // バックアップ状態更新。ロールバック自体は成功しているので、失敗しても警告だけ残す
      backup.status = 'rolled_back';
      const updateResult = yield* Effect.result(
        backupService.updateBackupMetadata(backup),
      );
      if (updateResult._tag === 'Failure') {
        logger.warnWithSentry({
          message: `Failed to update backup metadata after rollback: ${getBackupErrorMessage(updateResult.failure)}`,
          details: {
            backupId: backup.id,
            errorTag: updateResult.failure._tag,
          },
        });
      }

      logger.info(`Rollback completed successfully: ${backup.id}`);
    });
  }

  /**
   * バックアップデータの存在と整合性を確認
   */
  private validateBackupData(
    backupPath: string,
  ): Effect.Effect<void, RollbackServiceError> {
    return Effect.gen({ self: this }, function* () {
      // バックアップディレクトリの存在確認
      const backupExists = yield* Effect.tryPromise({
        try: () => existsAsync(backupPath),
        catch: (e) => {
          throw e;
        },
      }) as Effect.Effect<boolean, RollbackServiceError>;

      if (!backupExists) {
        return yield* Effect.fail(
          new RollbackBackupDirNotFound({ path: backupPath }),
        );
      }

      // メタデータファイルの存在確認
      const metadataPath = path.join(backupPath, 'backup-metadata.json');
      const metadataExists = yield* Effect.tryPromise({
        try: () => existsAsync(metadataPath),
        catch: (e) => {
          throw e;
        },
      }) as Effect.Effect<boolean, RollbackServiceError>;

      if (!metadataExists) {
        return yield* Effect.fail(
          new RollbackMetadataNotFound({ path: metadataPath }),
        );
      }

      // 月別ディレクトリの存在確認
      // readdir失敗は予期しないエラーなのでthrow
      const entries = yield* Effect.tryPromise({
        try: () => fs.readdir(backupPath, { withFileTypes: true }),
        catch: (e) => {
          throw e;
        },
      }) as Effect.Effect<NodeDirent[], RollbackServiceError>;

      const monthDirs = entries.filter(
        (entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name),
      );

      if (monthDirs.length === 0) {
        return yield* Effect.fail(
          new RollbackNoValidMonthData({ path: backupPath }),
        );
      }

      // 各月別ディレクトリ内のlogStoreファイル確認
      for (const monthDir of monthDirs) {
        const monthPath = path.join(backupPath, monthDir.name);
        const logStoreFile = path.join(
          monthPath,
          `logStore-${monthDir.name}.txt`,
        );

        const logStoreExists = yield* Effect.tryPromise({
          try: () => existsAsync(logStoreFile),
          catch: (e) => {
            throw e;
          },
        }) as Effect.Effect<boolean, RollbackServiceError>;

        if (!logStoreExists) {
          logger.warn(`logStore file not found: ${logStoreFile}`);
          // 一部のファイルが見つからなくても継続（警告のみ）
        }
      }

      logger.info(
        `Backup validation completed: ${monthDirs.length} month directories found`,
      );
    });
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
  private restoreLogStoreFromBackup(
    backupPath: string,
  ): Effect.Effect<void, RollbackServiceError> {
    return Effect.gen({ self: this }, function* () {
      const currentLogStoreDir = getLogStoreDir();

      // バックアップ内の月別フォルダを現在のlogStoreに復帰
      // readdir失敗は予期しないエラーなのでthrow
      const backupEntries = yield* Effect.tryPromise({
        try: () => fs.readdir(backupPath, { withFileTypes: true }),
        catch: (e) => {
          throw e;
        },
      }) as Effect.Effect<NodeDirent[], RollbackServiceError>;

      const monthDirs = backupEntries.filter(
        (entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name),
      );

      // 各月別ディレクトリをコピー
      // ファイルシステムエラーは予期しないエラーとしてthrow
      for (const monthDir of monthDirs) {
        const sourceDir = path.join(backupPath, monthDir.name);
        const targetDir = path.join(currentLogStoreDir, monthDir.name);

        yield* Effect.tryPromise({
          try: async () => {
            await fs.mkdir(targetDir, { recursive: true });
            await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
          },
          catch: (e) => {
            throw e;
          },
        }) as Effect.Effect<void, RollbackServiceError>;

        logger.info(`Restored month directory: ${monthDir.name}`);
      }

      if (monthDirs.length === 0) {
        return yield* Effect.fail(
          new RollbackNoDirsRestored({
            message: 'No month directories found in backup to restore',
          }),
        );
      }

      logger.info(
        `Successfully restored ${monthDirs.length} month directories from backup`,
      );
    });
  }

  /**
   * 復帰したlogStoreからDBを完全再構築
   * 予期しないエラーは上位のtry-catchでSentryに送信される
   */
  private rebuildDatabaseFromLogStore(): Effect.Effect<
    void,
    RollbackServiceError
  > {
    return Effect.gen(function* () {
      logger.info('Starting database rebuild from restored logStore');

      // 復帰したlogStoreからDBを完全再構築
      // syncLogs returns Effect<LogSyncResults, VRChatLogFileError | LogInfoError>
      yield* syncLogs(LOG_SYNC_MODE.FULL).pipe(
        Effect.mapError(
          (syncError) =>
            new RollbackDbRebuildFailed({ message: syncError.message }),
        ),
      );

      logger.info('Database rebuild completed successfully');
    });
  }
}

// デフォルトインスタンスをエクスポート
export const rollbackService = new RollbackService();
