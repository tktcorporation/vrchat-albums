import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import z from 'zod';
import { ERROR_CATEGORIES, UserFacingError } from '../../lib/errors';
import { logger } from './../../lib/logger';
import { eventEmitter, procedure, router as trpcRouter } from './../../trpc';
import * as vrchatLogFileDirService from './../vrchatLogFileDir/service';
import * as worldJoinLogService from './../vrchatWorldJoinLog/service';
import {
  backupService,
  getBackupErrorMessage,
} from './backupService/backupService';
import {
  getRollbackErrorMessage,
  rollbackService,
} from './backupService/rollbackService';
import { FILTER_PATTERNS } from './constants/logPatterns';
import { VRChatLogFileError } from './error';
import {
  exportLogStore,
  getExportErrorMessage,
} from './exportService/exportService';
import {
  getImportErrorMessage,
  importService,
} from './importService/importService';
import * as vrchatLogService from './service';

/**
 * もともとのVRC Log File 解析に必要な行だけ抜き出して、保管用のファイルに保存する
 * processAll=falseの場合、DBに保存されている最新のログ日時以降のみを処理するように改善
 * processAll=trueの場合、すべてのログファイルを処理する
 *
 * logStoreディレクトリは、VRChatログから抽出した必要な情報のみを保存するディレクトリです。
 * これは月ごとに整理され、`logStore/YYYY-MM/logStore-YYYY-MM.txt`という形式で保存されます。
 * 月ごとのログファイルがサイズ制限（10MB）を超えると、タイムスタンプ付きの新しいファイルが作成されます。
 * このディレクトリはメタデータの保存用ではなく、ログデータ自体の保存用です。
 */
export const appendLoglinesToFileFromLogFilePathList = async (
  processAll = false,
): Promise<neverthrow.Result<void, VRChatLogFileError>> => {
  const vrchatlogFilesDir =
    await vrchatLogFileDirService.getValidVRChatLogFileDir();
  if (vrchatlogFilesDir.isErr()) {
    return neverthrow.err(
      new VRChatLogFileError(
        match(vrchatlogFilesDir.error.error)
          .with('logFilesNotFound', () => 'LOG_FILES_NOT_FOUND' as const)
          .with('logFileDirNotFound', () => 'LOG_FILE_DIR_NOT_FOUND' as const)
          .exhaustive(),
      ),
    );
  }

  // DBから最新のログ日時を取得（processAllがfalseの場合のみ）
  let startDate = new Date(0); // デフォルトは最古の日時
  if (!processAll) {
    const latestWorldJoinLogResult =
      await worldJoinLogService.findLatestWorldJoinLog();
    if (latestWorldJoinLogResult.isOk() && latestWorldJoinLogResult.value) {
      startDate = latestWorldJoinLogResult.value.joinDateTime;
      logger.info(`Processing logs after ${startDate.toISOString()}`);
    } else {
      logger.info('No existing logs found in DB, processing all logs');
    }
  } else {
    logger.info('Processing all logs (processAll=true)');
  }

  // すべてのログファイルパスを取得
  const logFilePathList =
    await vrchatLogFileDirService.getVRChatLogFilePathList(
      vrchatlogFilesDir.value.path,
    );
  if (logFilePathList.isErr()) {
    return neverthrow.err(
      new VRChatLogFileError(
        match(logFilePathList.error)
          .with('ENOENT', () => 'LOG_FILE_DIR_NOT_FOUND' as const)
          .exhaustive(),
      ),
    );
  }

  logger.info(`Found ${logFilePathList.value.length} log files to process`);

  // ResultAsync.fromPromise でストリーミング処理のエラーを処理
  const streamResult = await ResultAsync.fromPromise(
    (async () => {
      let totalProcessedLines = 0;
      let hasProcessedAnyLines = false;

      // ストリーミング処理で各バッチを処理
      for await (const logLineBatch of vrchatLogService.getLogLinesByLogFilePathListStreaming(
        {
          logFilePathList: logFilePathList.value,
          includesList: [...FILTER_PATTERNS],
          batchSize: 1000, // バッチサイズを指定
          maxMemoryUsageMB: 500, // メモリ使用量の上限を500MBに制限
        },
      )) {
        // ログ行をフィルタリング（processAll=trueの場合はスキップ）
        const filteredLogLines = processAll
          ? logLineBatch
          : vrchatLogService.filterLogLinesByDate(logLineBatch, startDate);

        if (filteredLogLines.length > 0) {
          hasProcessedAnyLines = true;
          totalProcessedLines += filteredLogLines.length;

          logger.debug(
            `Processing batch of ${filteredLogLines.length} log lines`,
          );

          // 各バッチを保存
          const result = await vrchatLogService.appendLoglinesToFile({
            logLines: filteredLogLines,
          });
          if (result.isErr()) {
            // エラーをthrowしてerror handlerで処理
            throw result.error;
          }
        }
      }

      return { totalProcessedLines, hasProcessedAnyLines };
    })(),
    (error): VRChatLogFileError => {
      // VRChatLogFileError は予期されたエラーなのでそのまま返す
      if (error instanceof VRChatLogFileError) {
        return error;
      }
      // その他のエラーは予期しないエラーなので上位に伝播（Sentryに送信される）
      throw error;
    },
  );

  if (streamResult.isErr()) {
    return neverthrow.err(streamResult.error);
  }

  if (!streamResult.value.hasProcessedAnyLines) {
    logger.info('No new log lines to process after filtering');
    return neverthrow.ok(undefined);
  }

  logger.info(
    `Processing completed: ${streamResult.value.totalProcessedLines} log lines`,
  );

  return neverthrow.ok(undefined);
};

export const vrchatLogRouter = () =>
  trpcRouter({
    appendLoglinesToFileFromLogFilePathList: procedure
      .input(
        z
          .object({
            processAll: z.boolean().optional().default(false),
          })
          .optional()
          .default(() => ({ processAll: false })),
      )
      .mutation(async (opts) => {
        const { input } = opts;
        logger.info(
          `appendLoglinesToFileFromLogFilePathList (processAll=${input.processAll})`,
        );
        const result = await appendLoglinesToFileFromLogFilePathList(
          input.processAll,
        );
        if (result.isErr()) {
          throw result.error;
        }
        return result.value;
      }),
    exportLogStoreData: procedure
      .input(
        z.object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          outputPath: z.string().optional(),
        }),
      )
      .mutation(async (opts) => {
        const { input } = opts;
        const dateRangeMsg =
          input.startDate && input.endDate
            ? `${input.startDate.toISOString()} to ${input.endDate.toISOString()}`
            : '全期間';
        logger.info(`exportLogStoreData: ${dateRangeMsg}`);

        const exportResult = await exportLogStore({
          startDate: input.startDate,
          endDate: input.endDate,
          outputBasePath: input.outputPath,
        });

        if (exportResult.isErr()) {
          const errorMessage = getExportErrorMessage(exportResult.error);
          logger.error({
            message: `Export failed: ${errorMessage}`,
          });
          eventEmitter.emit(
            'toast',
            `エクスポートに失敗しました: ${errorMessage}`,
          );
          throw new UserFacingError(errorMessage, {
            code: 'EXPORT_ERROR',
            category: ERROR_CATEGORIES.UNKNOWN_ERROR,
            message: errorMessage,
            userMessage: errorMessage,
          });
        }

        const result = exportResult.value;

        logger.info(
          `Export completed: ${result.exportedFiles.length} files, ${result.totalLogLines} lines`,
        );

        eventEmitter.emit(
          'toast',
          `エクスポート完了: ${result.exportedFiles.length}ファイル、${result.totalLogLines}行`,
        );

        return result;
      }),
    createPreImportBackup: procedure.mutation(async () => {
      logger.info('Creating pre-import backup');

      // backupService.createPreImportBackup は Result 型を返すため、try-catch は不要
      // 予期しないエラーは自動的に throw されて Sentry に送信される
      const backupResult = await backupService.createPreImportBackup();

      if (backupResult.isErr()) {
        const errorMessage = getBackupErrorMessage(backupResult.error);
        logger.error({
          message: `Pre-import backup failed: ${errorMessage}`,
        });
        eventEmitter.emit(
          'toast',
          `バックアップ作成に失敗しました: ${errorMessage}`,
        );
        throw new Error(errorMessage);
      }

      const backup = backupResult.value;

      logger.info(`Pre-import backup created successfully: ${backup.id}`);
      eventEmitter.emit(
        'toast',
        `バックアップ作成完了: ${backup.exportFolderPath}`,
      );

      return backup;
    }),
    importLogStoreFiles: procedure
      .input(
        z.object({
          filePaths: z.array(z.string()),
        }),
      )
      .mutation(async (opts) => {
        const { input } = opts;
        logger.info(
          `Starting logStore import for ${input.filePaths.length} files`,
        );

        // importService.importLogStoreFiles は Result 型を返すため、try-catch は不要
        // 予期しないエラーは自動的に throw されて Sentry に送信される
        const importResult = await importService.importLogStoreFiles(
          input.filePaths,
        );

        if (importResult.isErr()) {
          const errorMessage = getImportErrorMessage(importResult.error);
          logger.error({
            message: `LogStore import failed: ${errorMessage}`,
          });
          eventEmitter.emit(
            'toast',
            `インポートに失敗しました: ${errorMessage}`,
          );
          throw new Error(errorMessage);
        }

        const result = importResult.value;

        logger.info(
          `LogStore import completed: ${result.importedData.totalLines} lines from ${result.importedData.processedFiles.length} files`,
        );

        eventEmitter.emit(
          'toast',
          `インポート完了: ${result.importedData.totalLines}行、${result.importedData.processedFiles.length}ファイル`,
        );

        return result;
      }),
    getImportBackupHistory: procedure.query(async () => {
      logger.info('Getting import backup history');

      const historyResult = await backupService.getBackupHistory();

      return historyResult.match(
        (history) => history,
        (error) => {
          const errorMessage = getBackupErrorMessage(error);
          logger.error({
            message: `Failed to get backup history: ${errorMessage}`,
          });
          throw new Error(errorMessage);
        },
      );
    }),
    rollbackToBackup: procedure
      .input(
        z.object({
          backupId: z.string(),
        }),
      )
      .mutation(async (opts) => {
        const { input } = opts;
        logger.info(`Starting rollback to backup: ${input.backupId}`);

        // backupService.getBackup, rollbackService.rollbackToBackup は Result 型を返すため、try-catch は不要
        // 予期しないエラーは自動的に throw されて Sentry に送信される
        const backupResult = await backupService.getBackup(input.backupId);
        if (backupResult.isErr()) {
          const errorMessage = getBackupErrorMessage(backupResult.error);
          logger.error({
            message: `Failed to get backup: ${errorMessage}`,
          });
          eventEmitter.emit(
            'toast',
            `バックアップの取得に失敗しました: ${errorMessage}`,
          );
          throw new Error(errorMessage);
        }

        const backup = backupResult.value;

        const rollbackResult = await rollbackService.rollbackToBackup(backup);
        if (rollbackResult.isErr()) {
          const errorMessage = getRollbackErrorMessage(rollbackResult.error);
          logger.error({
            message: `Rollback failed: ${errorMessage}`,
          });
          eventEmitter.emit(
            'toast',
            `ロールバックに失敗しました: ${errorMessage}`,
          );
          throw new Error(errorMessage);
        }

        logger.info(`Rollback completed successfully: ${input.backupId}`);
        eventEmitter.emit(
          'toast',
          `ロールバック完了: ${backup.exportFolderPath}に復帰しました`,
        );

        return { success: true, backup };
      }),
  });
