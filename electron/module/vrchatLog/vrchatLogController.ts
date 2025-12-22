import * as neverthrow from 'neverthrow';
import { match, P } from 'ts-pattern';
import z from 'zod';
import { logger } from './../../lib/logger';
import { eventEmitter, procedure, router as trpcRouter } from './../../trpc';
import * as playerJoinLogService from './../VRChatPlayerJoinLogModel/playerJoinLog.service';
import * as playerLeaveLogService from './../VRChatPlayerLeaveLogModel/playerLeaveLog.service';
import * as vrchatLogFileDirService from './../vrchatLogFileDir/service';
import * as worldJoinLogService from './../vrchatWorldJoinLog/service';
import { backupService } from './backupService/backupService';
import { rollbackService } from './backupService/rollbackService';
import { FILTER_PATTERNS } from './constants/logPatterns';
import type { LogRecord } from './converters/dbToLogStore';
import { VRChatLogFileError } from './error';
import { exportLogStoreFromDB } from './exportService/exportService';
import { importService } from './importService/importService';
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

  let totalProcessedLines = 0;
  let hasProcessedAnyLines = false;

  try {
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
          return neverthrow.err(result.error);
        }
      }
    }
  } catch (error) {
    // VRChatLogFileError は予期されたエラーなのでそのまま返す
    if (error instanceof VRChatLogFileError) {
      return neverthrow.err(error);
    }
    // その他のエラーは予期しないエラーなので上位に伝播（Sentryに送信される）
    throw error;
  }

  if (!hasProcessedAnyLines) {
    logger.info('No new log lines to process after filtering');
    return neverthrow.ok(undefined);
  }

  logger.info(`Processing completed: ${totalProcessedLines} log lines`);

  return neverthrow.ok(undefined);
};

/**
 * DBからlogStore形式でエクスポートする
 * 期間指定がない場合は全データを取得
 */
const getDBLogsFromDatabase = async (
  startDate?: Date,
  endDate?: Date,
): Promise<LogRecord[]> => {
  const logRecords: LogRecord[] = [];

  // ワールド参加ログを取得
  const worldJoinQueryOptions: Parameters<
    typeof worldJoinLogService.findVRChatWorldJoinLogList
  >[0] = {
    orderByJoinDateTime: 'asc',
  };

  // 期間指定がある場合のみフィルタを追加
  if (startDate) {
    worldJoinQueryOptions.gtJoinDateTime = startDate;
  }
  if (endDate) {
    worldJoinQueryOptions.ltJoinDateTime = endDate;
  }

  const worldJoinResult = await worldJoinLogService.findVRChatWorldJoinLogList(
    worldJoinQueryOptions,
  );

  for (const log of worldJoinResult) {
    logRecords.push({
      type: 'worldJoin',
      record: {
        id: log.id,
        worldId: log.worldId,
        worldName: log.worldName,
        worldInstanceId: log.worldInstanceId,
        joinDateTime: log.joinDateTime,
        createdAt: log.createdAt,
        updatedAt: log.updatedAt || new Date(),
      },
    });
  }

  // プレイヤー参加ログを取得
  let playerJoinResult: Awaited<
    ReturnType<
      typeof playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime
    >
  >;

  if (startDate) {
    playerJoinResult =
      await playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime({
        startJoinDateTime: startDate,
        endJoinDateTime: endDate || null,
      });
  } else {
    // 期間指定がない場合は、最古の日付から現在までを取得
    const oldestDate = new Date('2017-01-01'); // VRChatリリース日程度
    playerJoinResult =
      await playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime({
        startJoinDateTime: oldestDate,
        endJoinDateTime: endDate || new Date(),
      });
  }

  if (playerJoinResult.isOk()) {
    for (const log of playerJoinResult.value) {
      logRecords.push({
        type: 'playerJoin',
        record: {
          id: log.id,
          playerName: log.playerName,
          playerId: log.playerId,
          joinDateTime: log.joinDateTime,
          createdAt: log.createdAt,
          updatedAt: log.updatedAt || new Date(),
        },
      });
    }
  }

  // プレイヤー退出ログを取得
  const playerLeaveQueryOptions: Parameters<
    typeof playerLeaveLogService.findVRChatPlayerLeaveLogList
  >[0] = {
    orderByLeaveDateTime: 'asc',
  };

  // 期間指定がある場合のみフィルタを追加
  if (startDate) {
    playerLeaveQueryOptions.gtLeaveDateTime = startDate;
  }
  if (endDate) {
    playerLeaveQueryOptions.ltLeaveDateTime = endDate;
  }

  const playerLeaveResult =
    await playerLeaveLogService.findVRChatPlayerLeaveLogList(
      playerLeaveQueryOptions,
    );

  for (const log of playerLeaveResult) {
    logRecords.push({
      type: 'playerLeave',
      record: {
        id: log.id,
        playerName: log.playerName,
        playerId: log.playerId,
        leaveDateTime: log.leaveDateTime,
        createdAt: log.createdAt,
        updatedAt: log.updatedAt || new Date(),
      },
    });
  }

  // TODO: アプリイベントログの取得は今後実装
  // const appEventRecords = await appEventService.getAppEventLogRecords(
  //   startDate,
  //   endDate,
  // );
  // logRecords.push(...appEventRecords);

  return logRecords;
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
            ? `${input.startDate.toISOString()} to ${input.endDate.toISOString()} (received as local time, converted to UTC for DB query)`
            : '全期間';
        logger.info(`exportLogStoreData: ${dateRangeMsg}`);

        try {
          const result = await exportLogStoreFromDB(
            {
              startDate: input.startDate,
              endDate: input.endDate,
              outputBasePath: input.outputPath,
            },
            getDBLogsFromDatabase,
          );

          logger.info(
            `Export completed: ${result.exportedFiles.length} files, ${result.totalLogLines} lines`,
          );

          eventEmitter.emit(
            'toast',
            `エクスポート完了: ${result.exportedFiles.length}ファイル、${result.totalLogLines}行`,
          );

          return result;
        } catch (error) {
          logger.error({
            message: `Export failed: ${String(error)}`,
          });
          const errorMessage = match(error)
            .with(P.instanceOf(Error), (err) => err.message)
            .otherwise((err) => String(err));
          eventEmitter.emit(
            'toast',
            `エクスポートに失敗しました: ${errorMessage}`,
          );
          throw error;
        }
      }),
    createPreImportBackup: procedure.mutation(async () => {
      logger.info('Creating pre-import backup');

      try {
        const backupResult = await backupService.createPreImportBackup(
          getDBLogsFromDatabase,
        );

        if (backupResult.isErr()) {
          logger.error({
            message: `Pre-import backup failed: ${backupResult.error.message}`,
          });
          eventEmitter.emit(
            'toast',
            `バックアップ作成に失敗しました: ${backupResult.error.message}`,
          );
          throw backupResult.error;
        }

        const backup = backupResult.value;

        logger.info(`Pre-import backup created successfully: ${backup.id}`);
        eventEmitter.emit(
          'toast',
          `バックアップ作成完了: ${backup.exportFolderPath}`,
        );

        return backup;
      } catch (error) {
        logger.error({
          message: `Pre-import backup failed: ${String(error)}`,
        });
        const errorMessage = match(error)
          .with(P.instanceOf(Error), (err) => err.message)
          .otherwise((err) => String(err));
        eventEmitter.emit(
          'toast',
          `バックアップ作成に失敗しました: ${errorMessage}`,
        );
        throw error;
      }
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

        try {
          const importResult = await importService.importLogStoreFiles(
            input.filePaths,
            getDBLogsFromDatabase,
          );

          if (importResult.isErr()) {
            logger.error({
              message: `LogStore import failed: ${importResult.error.message}`,
            });
            eventEmitter.emit(
              'toast',
              `インポートに失敗しました: ${importResult.error.message}`,
            );
            throw importResult.error;
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
        } catch (error) {
          logger.error({
            message: `LogStore import failed: ${String(error)}`,
          });
          const errorMessage = match(error)
            .with(P.instanceOf(Error), (err) => err.message)
            .otherwise((err) => String(err));
          eventEmitter.emit(
            'toast',
            `インポートに失敗しました: ${errorMessage}`,
          );
          throw error;
        }
      }),
    getImportBackupHistory: procedure.query(async () => {
      logger.info('Getting import backup history');

      try {
        const historyResult = await backupService.getBackupHistory();

        if (historyResult.isErr()) {
          logger.error({
            message: `Failed to get backup history: ${historyResult.error.message}`,
          });
          throw historyResult.error;
        }

        return historyResult.value;
      } catch (error) {
        logger.error({
          message: `Failed to get backup history: ${String(error)}`,
        });
        throw error;
      }
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

        try {
          const backupResult = await backupService.getBackup(input.backupId);
          if (backupResult.isErr()) {
            logger.error({
              message: `Failed to get backup: ${backupResult.error.message}`,
            });
            eventEmitter.emit(
              'toast',
              `バックアップが見つかりません: ${backupResult.error.message}`,
            );
            throw backupResult.error;
          }

          const backup = backupResult.value;

          const rollbackResult = await rollbackService.rollbackToBackup(backup);
          if (rollbackResult.isErr()) {
            logger.error({
              message: `Rollback failed: ${rollbackResult.error.message}`,
            });
            eventEmitter.emit(
              'toast',
              `ロールバックに失敗しました: ${rollbackResult.error.message}`,
            );
            throw rollbackResult.error;
          }

          logger.info(`Rollback completed successfully: ${input.backupId}`);
          eventEmitter.emit(
            'toast',
            `ロールバック完了: ${backup.exportFolderPath}に復帰しました`,
          );

          return { success: true, backup };
        } catch (error) {
          logger.error({
            message: `Rollback failed: ${String(error)}`,
          });
          const errorMessage = match(error)
            .with(P.instanceOf(Error), (err) => err.message)
            .otherwise((err) => String(err));
          eventEmitter.emit(
            'toast',
            `ロールバックに失敗しました: ${errorMessage}`,
          );
          throw error;
        }
      }),
  });
