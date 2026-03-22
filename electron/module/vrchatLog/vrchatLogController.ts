import { Cause, Effect, Exit, Option } from 'effect';
import { match } from 'ts-pattern';
import z from 'zod';
import { runEffect } from '../../lib/effectTRPC';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { logger } from './../../lib/logger';
import { eventEmitter, procedure, router as trpcRouter } from './../../trpc';
import * as playerJoinLogService from './../VRChatPlayerJoinLogModel/playerJoinLog.service';
import * as playerLeaveLogService from './../VRChatPlayerLeaveLogModel/playerLeaveLog.service';
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
import type { LogRecord } from './converters/dbToLogStore';
import { VRChatLogFileError } from './error';
import {
  exportLogStoreFromDB,
  getExportErrorMessage,
} from './exportService/exportService';
import {
  getImportErrorMessage,
  importService,
} from './importService/importService';
import type { VRChatLogLine } from './model';
import * as vrchatLogService from './service';

/**
 * appendLoglines の結果
 *
 * 背景: 処理済みのログ行を後続の loadLogInfoIndexFromVRChatLog に直接渡すことで、
 * logStore ファイルの再読み込みを回避し、起動時間を短縮する。
 */
export interface AppendLoglinesResult {
  /** appendLoglines に渡されたログ行（日付フィルタ済み、logStore との重複除外は未実施） */
  processedLogLines: VRChatLogLine[];
}

/**
 * もともとのVRC Log File 解析に必要な行だけ抜き出して、保管用のファイルに保存する
 * processAll=falseの場合、DBに保存されている最新のログ日時以降のみを処理するように改善
 * processAll=trueの場合、すべてのログファイルを処理する
 *
 * logStoreディレクトリは、VRChatログから抽出した必要な情報のみを保存するディレクトリです。
 * これは月ごとに整理され、`logStore/YYYY-MM/logStore-YYYY-MM.txt`という形式で保存されます。
 * 月ごとのログファイルがサイズ制限（10MB）を超えると、タイムスタンプ付きの新しいファイルが作成されます。
 * このディレクトリはメタデータの保存用ではなく、ログデータ自体の保存用です。
 *
 * @returns 処理結果。processedLogLines に新規処理されたログ行を含む。
 */
export const appendLoglinesToFileFromLogFilePathList = async (
  processAll = false,
): Promise<AppendLoglinesResult> => {
  const vrchatlogFilesDirExit = await Effect.runPromiseExit(
    vrchatLogFileDirService.getValidVRChatLogFileDir(),
  );
  if (Exit.isFailure(vrchatlogFilesDirExit)) {
    const failOpt = Cause.failureOption(vrchatlogFilesDirExit.cause);
    if (Option.isSome(failOpt)) {
      throw new VRChatLogFileError(
        match(failOpt.value.error)
          .with('logFilesNotFound', () => 'LOG_FILES_NOT_FOUND' as const)
          .with('logFileDirNotFound', () => 'LOG_FILE_DIR_NOT_FOUND' as const)
          .exhaustive(),
      );
    }
    const dieOpt = Cause.dieOption(vrchatlogFilesDirExit.cause);
    if (Option.isSome(dieOpt)) {
      throw dieOpt.value;
    }
    throw new Error('Effect was interrupted or failed with an unknown cause');
  }
  const vrchatlogFilesDir = vrchatlogFilesDirExit.value;

  // DBから最新のログ日時を取得（processAllがfalseの場合のみ）
  let startDate = new Date(0); // デフォルトは最古の日時
  if (!processAll) {
    const latestWorldJoinLogExit = await Effect.runPromiseExit(
      worldJoinLogService.findLatestWorldJoinLog(),
    );
    if (
      Exit.isSuccess(latestWorldJoinLogExit) &&
      latestWorldJoinLogExit.value
    ) {
      startDate = latestWorldJoinLogExit.value.joinDateTime;
      logger.info(`Processing logs after ${startDate.toISOString()}`);
    } else {
      logger.info('No existing logs found in DB, processing all logs');
    }
  } else {
    logger.info('Processing all logs (processAll=true)');
  }

  // すべてのログファイルパスを取得
  const logFilePathListExit = await Effect.runPromiseExit(
    vrchatLogFileDirService.getVRChatLogFilePathList(vrchatlogFilesDir.path),
  );
  if (Exit.isFailure(logFilePathListExit)) {
    const failOpt = Cause.failureOption(logFilePathListExit.cause);
    if (Option.isSome(failOpt)) {
      throw new VRChatLogFileError('LOG_FILE_DIR_NOT_FOUND' as const);
    }
    const dieOpt = Cause.dieOption(logFilePathListExit.cause);
    if (Option.isSome(dieOpt)) {
      throw dieOpt.value;
    }
    throw new Error('Effect was interrupted or failed with an unknown cause');
  }
  const logFilePathList = logFilePathListExit.value;

  logger.info(`Found ${logFilePathList.length} log files to process`);

  let totalProcessedLines = 0;
  let hasProcessedAnyLines = false;
  const allProcessedLines: VRChatLogLine[] = [];

  // 重複判定キャッシュを作成（sync操作全体で共有し、
  // バッチごとのlogStoreファイル再読み込みを回避する）
  const dedupCache = vrchatLogService.createDedupCache();

  // ストリーミング処理で各バッチを処理
  for await (const logLineBatch of vrchatLogService.getLogLinesByLogFilePathListStreaming(
    {
      logFilePathList: logFilePathList,
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
      // loadLogInfo に渡すために処理済み行を収集
      allProcessedLines.push(...filteredLogLines);

      logger.debug(`Processing batch of ${filteredLogLines.length} log lines`);

      // 各バッチを保存（dedupCacheで重複判定を高速化）
      // appendLoglinesToFile は Effect<void, never>
      await Effect.runPromise(
        vrchatLogService.appendLoglinesToFile({
          logLines: filteredLogLines,
          dedupCache,
        }),
      );
    }
  }

  if (!hasProcessedAnyLines) {
    logger.info('No new log lines to process after filtering');
    return { processedLogLines: [] };
  }

  logger.info(`Processing completed: ${totalProcessedLines} log lines`);

  return {
    processedLogLines: allProcessedLines,
  };
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
  let playerJoinStartDate = startDate;
  if (!playerJoinStartDate) {
    // 期間指定がない場合は、最古の日付から現在までを取得
    playerJoinStartDate = new Date('2017-01-01'); // VRChatリリース日程度
  }

  const playerJoinLogExit = await Effect.runPromiseExit(
    playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime({
      startJoinDateTime: playerJoinStartDate,
      endJoinDateTime: endDate || null,
    }),
  );

  if (Exit.isSuccess(playerJoinLogExit)) {
    for (const log of playerJoinLogExit.value) {
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
        await appendLoglinesToFileFromLogFilePathList(input.processAll);
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

        const result = await runEffect(
          exportLogStoreFromDB(
            {
              startDate: input.startDate,
              endDate: input.endDate,
              outputBasePath: input.outputPath,
            },
            getDBLogsFromDatabase,
          ).pipe(
            Effect.mapError((e) => {
              const errorMessage = getExportErrorMessage(e);
              logger.error({ message: `Export failed: ${errorMessage}` });
              eventEmitter.emit(
                'toast',
                `エクスポートに失敗しました: ${errorMessage}`,
              );
              return UserFacingError.withStructuredInfo({
                code: ERROR_CODES.EXPORT_ERROR,
                category: ERROR_CATEGORIES.UNKNOWN_ERROR,
                message: errorMessage,
                userMessage: errorMessage,
                cause: e,
              });
            }),
          ),
        );

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

      const backup = await runEffect(
        backupService.createPreImportBackup(getDBLogsFromDatabase).pipe(
          Effect.mapError((e) => {
            const errorMessage = getBackupErrorMessage(e);
            logger.error({
              message: `Pre-import backup failed: ${errorMessage}`,
            });
            eventEmitter.emit(
              'toast',
              `バックアップ作成に失敗しました: ${errorMessage}`,
            );
            return UserFacingError.withStructuredInfo({
              code: ERROR_CODES.UNKNOWN,
              category: ERROR_CATEGORIES.UNKNOWN_ERROR,
              message: errorMessage,
              userMessage: `バックアップ作成に失敗しました: ${errorMessage}`,
              cause: e,
            });
          }),
        ),
      );

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

        const result = await runEffect(
          importService
            .importLogStoreFiles(input.filePaths, getDBLogsFromDatabase)
            .pipe(
              Effect.mapError((e) => {
                const errorMessage = getImportErrorMessage(e);
                logger.error({
                  message: `LogStore import failed: ${errorMessage}`,
                });
                eventEmitter.emit(
                  'toast',
                  `インポートに失敗しました: ${errorMessage}`,
                );
                return UserFacingError.withStructuredInfo({
                  code: ERROR_CODES.UNKNOWN,
                  category: ERROR_CATEGORIES.UNKNOWN_ERROR,
                  message: errorMessage,
                  userMessage: `インポートに失敗しました: ${errorMessage}`,
                  cause: e,
                });
              }),
            ),
        );

        logger.info(
          `LogStore import completed: ${result.importedData.totalLines} lines from ${result.importedData.processedFiles.length} files`,
        );

        eventEmitter.emit(
          'toast',
          `インポート完了: ${result.importedData.totalLines}行、${result.importedData.processedFiles.length}ファイル`,
        );

        return result;
      }),
    getImportBackupHistory: procedure.query(() => {
      logger.info('Getting import backup history');

      return runEffect(
        backupService.getBackupHistory().pipe(
          Effect.mapError((e) => {
            const errorMessage = getBackupErrorMessage(e);
            logger.error({
              message: `Failed to get backup history: ${errorMessage}`,
            });
            return UserFacingError.withStructuredInfo({
              code: ERROR_CODES.UNKNOWN,
              category: ERROR_CATEGORIES.UNKNOWN_ERROR,
              message: errorMessage,
              userMessage: `バックアップ履歴の取得に失敗しました: ${errorMessage}`,
              cause: e,
            });
          }),
        ),
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

        const backup = await runEffect(
          backupService.getBackup(input.backupId).pipe(
            Effect.mapError((e) => {
              const errorMessage = getBackupErrorMessage(e);
              logger.error({
                message: `Failed to get backup: ${errorMessage}`,
              });
              eventEmitter.emit(
                'toast',
                `バックアップの取得に失敗しました: ${errorMessage}`,
              );
              return UserFacingError.withStructuredInfo({
                code: ERROR_CODES.UNKNOWN,
                category: ERROR_CATEGORIES.UNKNOWN_ERROR,
                message: errorMessage,
                userMessage: `バックアップの取得に失敗しました: ${errorMessage}`,
                cause: e,
              });
            }),
          ),
        );

        await runEffect(
          rollbackService.rollbackToBackup(backup).pipe(
            Effect.mapError((e) => {
              const errorMessage = getRollbackErrorMessage(e);
              logger.error({ message: `Rollback failed: ${errorMessage}` });
              eventEmitter.emit(
                'toast',
                `ロールバックに失敗しました: ${errorMessage}`,
              );
              return UserFacingError.withStructuredInfo({
                code: ERROR_CODES.UNKNOWN,
                category: ERROR_CATEGORIES.UNKNOWN_ERROR,
                message: errorMessage,
                userMessage: `ロールバックに失敗しました: ${errorMessage}`,
                cause: e,
              });
            }),
          ),
        );

        logger.info(`Rollback completed successfully: ${input.backupId}`);
        eventEmitter.emit(
          'toast',
          `ロールバック完了: ${backup.exportFolderPath}に復帰しました`,
        );

        return { success: true, backup };
      }),
  });
