import { performance } from 'node:perf_hooks';
import { col, fn, literal, Op } from '@sequelize/core';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { err, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { logger } from '../../lib/logger';
import { emitStageProgress, emitStageStart } from '../initProgress/emitter';
import { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import type { VRChatPlayerLeaveLogModel } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import * as playerLeaveLogService from '../VRChatPlayerLeaveLogModel/playerLeaveLog.service';
import type { VRChatLogFileError } from '../vrchatLog/error';
import type { VRChatLogStoreFilePath } from '../vrchatLog/model';
import type {
  VRChatPlayerJoinLog,
  VRChatPlayerLeaveLog,
  VRChatWorldJoinLog,
} from '../vrchatLog/service';
import * as vrchatLogService from '../vrchatLog/service';
import type { VRChatPhotoPathModel } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import * as vrchatPhotoService from '../vrchatPhoto/vrchatPhoto.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { LogInfoError } from './error';

interface LogProcessingResults {
  createdWorldJoinLogModelList: VRChatWorldJoinLogModel[];
  createdPlayerJoinLogModelList: VRChatPlayerJoinLogModel[];
  createdPlayerLeaveLogModelList: VRChatPlayerLeaveLogModel[];
  createdVRChatPhotoPathModelList: VRChatPhotoPathModel[];
  // TODO: アプリイベントの処理は今後実装
  // createdAppEventCount: number;
}

/**
 * 処理対象となるVRChatのログファイルパスを取得する
 * @param excludeOldLogLoad trueの場合、DBに保存されている最新のログ日時以降のログのみを処理します。
 *                           falseの場合、2000年1月1日からすべてのログを処理します。
 */
function _getLogStoreFilePathsImpl(
  excludeOldLogLoad: boolean,
): ResultAsync<VRChatLogStoreFilePath[], LogInfoError> {
  return ResultAsync.fromPromise(
    (async () => {
      const startTime = performance.now();
      let startDate: Date;
      const logStoreFilePaths: VRChatLogStoreFilePath[] = [];

      if (excludeOldLogLoad) {
        const findLatestStartTime = performance.now();
        // DBに保存されている最新のログ日時を取得
        const [
          latestWorldJoinDateResult,
          latestPlayerJoinDateResult,
          latestPlayerLeaveDate,
        ] = await Promise.all([
          worldJoinLogService.findLatestWorldJoinLog(),
          playerJoinLogService.findLatestPlayerJoinLog(),
          playerLeaveLogService.findLatestPlayerLeaveLog(),
        ]);
        const findLatestEndTime = performance.now();
        logger.debug(
          `_getLogStoreFilePaths: Find latest logs took ${
            findLatestEndTime - findLatestStartTime
          } ms`,
        );

        // DBエラーは予期されたエラーとしてResultで返す
        if (latestWorldJoinDateResult.isErr()) {
          throw new LogInfoError({
            code: 'DATABASE_QUERY_FAILED',
            message: `Failed to get latest world join log: ${latestWorldJoinDateResult.error.message}`,
          });
        }
        if (latestPlayerJoinDateResult.isErr()) {
          throw new LogInfoError({
            code: 'DATABASE_QUERY_FAILED',
            message: `Failed to get latest player join log: ${latestPlayerJoinDateResult.error.message}`,
          });
        }
        const latestWorldJoinDate = latestWorldJoinDateResult.value;
        const latestPlayerJoinDate =
          latestPlayerJoinDateResult.value?.joinDateTime;

        // 最新の日時をフィルタリングしてソート
        const dates = [
          latestWorldJoinDate?.joinDateTime,
          latestPlayerJoinDate,
          latestPlayerLeaveDate?.leaveDateTime,
        ]
          .filter((d): d is Date => d instanceof Date) // Date型のみをフィルタリング
          .sort(datefns.compareAsc);
        logger.debug(`_getLogStoreFilePaths: latest dates: ${dates}`);

        // 最新の日付を取得、なければ1年前
        startDate = dates.at(-1) ?? datefns.subYears(new Date(), 1);
      } else {
        // すべてのログを読み込む場合は、非常に古い日付から
        startDate = datefns.parseISO('2000-01-01');
        const getLegacyPathStartTime = performance.now();
        // 旧形式のログファイルも追加 (excludeOldLogLoadがfalseの場合のみ)
        const legacyLogStoreFilePath =
          await vrchatLogService.getLegacyLogStoreFilePath();
        const getLegacyPathEndTime = performance.now();
        logger.debug(
          `_getLogStoreFilePaths: Get legacy log path took ${
            getLegacyPathEndTime - getLegacyPathStartTime
          } ms`,
        );
        if (legacyLogStoreFilePath) {
          logStoreFilePaths.push(legacyLogStoreFilePath);
        }
      }

      const getPathsInRangeStartTime = performance.now();
      // 日付範囲内のすべてのログファイルパスを取得して追加
      const pathsInRange = await vrchatLogService.getLogStoreFilePathsInRange(
        startDate,
        new Date(),
      );
      const getPathsInRangeEndTime = performance.now();
      logger.debug(
        `_getLogStoreFilePaths: Get paths in range took ${
          getPathsInRangeEndTime - getPathsInRangeStartTime
        } ms`,
      );
      logStoreFilePaths.push(...pathsInRange);

      const endTime = performance.now();
      logger.debug(`_getLogStoreFilePaths took ${endTime - startTime} ms`);

      return logStoreFilePaths;
    })(),
    (error) =>
      error instanceof LogInfoError
        ? error
        : new LogInfoError({
            code: 'UNKNOWN',
            message: error instanceof Error ? error.message : String(error),
          }),
  );
}

function _getLogStoreFilePaths(
  excludeOldLogLoad: boolean,
): ResultAsync<VRChatLogStoreFilePath[], LogInfoError> {
  return _getLogStoreFilePathsImpl(excludeOldLogLoad);
}

/**
 * VRChatのログファイルからログ情報をロードしてデータベースに保存する
 *
 * @param options.excludeOldLogLoad - trueの場合、DBに保存されている最新のログ日時以降のログのみを処理します。
 *                                   falseの場合、2000年1月1日からすべてのログを処理します。
 *                                   デフォルトはfalseです。
 *
 * 処理の流れ:
 * 1. 写真フォルダからログ情報を読み込み、保存します
 *    - 写真フォルダが存在しない場合はスキップします（正常系）
 *    - 写真フォルダが存在する場合のみ、ログ情報を保存します
 *
 * 2. ログファイルの日付範囲を決定: ( _getLogStoreFilePaths に移動 )
 *    - excludeOldLogLoad = true: DBに保存されている最新のログ日時以降のログファイルのみ
 *    - excludeOldLogLoad = false: すべてのログファイル（2000年1月1日以降）
 *
 * 3. ログのフィルタリング:
 *    - excludeOldLogLoad = true の場合:
 *      - World Join: 最新のWorldJoinLog以降
 *      - Player Join: 最新のPlayerJoinLog以降
 *      - Player Leave: 最新のPlayerLeaveLog以降
 *    - excludeOldLogLoad = false の場合:
 *      - すべてのログを処理
 *
 * 4. 写真のインデックス処理:
 *    - excludeOldLogLoad = true の場合:
 *      - 最新の写真日時以降のみを処理
 *    - excludeOldLogLoad = false の場合:
 *      - すべての写真を処理
 *
 * 5. ログデータベースへの保存:
 *    - フィルタリングされたログをバッチに分けてDBに保存
 *    - 写真パスインデックスもDBに保存
 *
 * ※重要な注意点:
 * - 通常の更新（Header.tsxのhandleRefresh など）では excludeOldLogLoad = true が推奨されます
 *   これにより、最新のログのみが処理され、パフォーマンスが向上します
 * - 初回読み込みやデータ修復などでは excludeOldLogLoad = false を使用して
 *   すべてのログを処理する必要があります
 * - Header.tsx で refreshボタンが押されたときは、先に appendLoglinesToFileFromLogFilePathList
 *   で新しいログを抽出・保存してから、この関数を呼び出す必要があります
 *   それにより、新しいログ分もデータベースに保存されます
 *
 * @returns 作成されたログモデルのリストを含むResultオブジェクト
 *          - createdWorldJoinLogModelList: 作成されたワールド参加ログ
 *          - createdPlayerJoinLogModelList: 作成されたプレイヤー参加ログ
 *          - createdPlayerLeaveLogModelList: 作成されたプレイヤー退出ログ
 *          - createdVRChatPhotoPathModelList: 作成された写真パスモデル
 */
export async function loadLogInfoIndexFromVRChatLog({
  excludeOldLogLoad = false,
}: {
  excludeOldLogLoad?: boolean;
} = {}): Promise<
  neverthrow.Result<LogProcessingResults, VRChatLogFileError | LogInfoError>
> {
  const totalStartTime = performance.now();
  logger.info('loadLogInfoIndexFromVRChatLog start');

  // 1. 処理対象となるログファイルパスを取得
  const getLogPathsStartTime = performance.now();
  const logStoreFilePathsResult =
    await _getLogStoreFilePaths(excludeOldLogLoad);
  if (logStoreFilePathsResult.isErr()) {
    return err(logStoreFilePathsResult.error);
  }
  const logStoreFilePaths = logStoreFilePathsResult.value;
  const getLogPathsEndTime = performance.now();
  logger.debug(
    `Get log store file paths took ${
      getLogPathsEndTime - getLogPathsStartTime
    } ms`,
  );
  logger.info(
    `loadLogInfoIndexFromVRChatLog excludeOldLogLoad: ${excludeOldLogLoad} target: ${logStoreFilePaths.map(
      (path) => path.value,
    )}`,
  );

  // 3. ログファイルからログ情報を取得（部分的な成功を許容）
  const getLogInfoStartTime = performance.now();
  const logInfoListFromLogFileResult =
    await vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess(
      logStoreFilePaths,
    );
  // この関数は never エラーなので常に成功
  const logInfoListFromLogFile = logInfoListFromLogFileResult._unsafeUnwrap();
  const getLogInfoEndTime = performance.now();
  logger.debug(
    `Get VRChat log info from log files took ${
      getLogInfoEndTime - getLogInfoStartTime
    } ms`,
  );

  // エラーがあった場合は警告を出力し、Sentryにも送信
  if (logInfoListFromLogFile.errorCount > 0) {
    const errorSummary = `Failed to process ${logInfoListFromLogFile.errorCount} log files out of ${logInfoListFromLogFile.totalProcessed}`;
    const errorDetails = logInfoListFromLogFile.errors.map((e) => ({
      path: e.path,
      code: e.error.code,
    }));

    logger.warn(errorSummary, errorDetails);

    // 部分的な失敗もSentryに送信（エラーレベルで記録）
    // カスタムエラークラスを定義して型安全にする
    interface PartialLogLoadFailureError extends Error {
      errorDetails: Array<{ path: string; code: string }>;
    }

    const partialFailureError = new Error(
      errorSummary,
    ) as PartialLogLoadFailureError;
    partialFailureError.name = 'PartialLogLoadFailure';
    partialFailureError.errorDetails = errorDetails;

    logger.error({
      message: partialFailureError,
      stack: partialFailureError,
    });
  }

  // 成功したログが1つもない場合のみエラーを返す
  if (
    logInfoListFromLogFile.successCount === 0 &&
    logInfoListFromLogFile.errorCount > 0
  ) {
    return neverthrow.err(logInfoListFromLogFile.errors[0].error);
  }

  const logInfoList = logInfoListFromLogFile.data;

  const filterLogsStartTime = performance.now();
  const newLogs = await match(excludeOldLogLoad)
    // DBの最新日時以降のログのみをフィルタリング
    .with(true, async () => {
      const findLatestStartTime = performance.now();
      // ログの最新日時を取得
      const [
        latestWorldJoinDateResult,
        latestPlayerJoinDateResult,
        latestPlayerLeaveDate,
      ] = await Promise.all([
        worldJoinLogService.findLatestWorldJoinLog(),
        playerJoinLogService.findLatestPlayerJoinLog(),
        playerLeaveLogService.findLatestPlayerLeaveLog(),
      ]);
      const findLatestEndTime = performance.now();
      logger.debug(
        `Filtering: Find latest logs took ${
          findLatestEndTime - findLatestStartTime
        } ms`,
      );

      // DBエラーは予期しないエラーなのでthrowして上位に伝播（Sentryに送信される）
      if (latestWorldJoinDateResult.isErr()) {
        throw new Error(
          `Failed to get latest world join log: ${latestWorldJoinDateResult.error.message}`,
        );
      }
      if (latestPlayerJoinDateResult.isErr()) {
        throw new Error(
          `Failed to get latest player join log: ${latestPlayerJoinDateResult.error.message}`,
        );
      }
      const latestWorldJoinDate = latestWorldJoinDateResult.value;
      const latestPlayerJoinDate = latestPlayerJoinDateResult.value;

      const filterStartTime = performance.now();
      const filtered = logInfoList.filter((log) => {
        switch (log.logType) {
          case 'worldJoin':
            return (
              !latestWorldJoinDate ||
              log.joinDate > latestWorldJoinDate.joinDateTime
            );
          case 'playerJoin':
            return (
              !latestPlayerJoinDate ||
              log.joinDate > latestPlayerJoinDate.joinDateTime
            );
          case 'playerLeave':
            return (
              !latestPlayerLeaveDate ||
              log.leaveDate > latestPlayerLeaveDate.leaveDateTime
            );
          case 'worldLeave':
            // ワールド退出はDBに保存しないのでスキップ
            return false;
          // TODO: アプリイベントの処理は今後実装
          // case 'appStart':
          // case 'appExit':
          // case 'appVersion':
          //   // アプリイベントは常に保存（重複はDB側で除外）
          //   return true;
          default:
            return false;
        }
      });
      const filterEndTime = performance.now();
      logger.debug(
        `Filtering: Actual filtering took ${
          filterEndTime - filterStartTime
        } ms`,
      );
      return filtered;
    })
    // すべてのログを読み込む
    .with(false, async () => logInfoList)
    .exhaustive();
  const filterLogsEndTime = performance.now();
  logger.debug(
    `Filtering logs took ${filterLogsEndTime - filterLogsStartTime} ms`,
  );

  const results: LogProcessingResults = {
    createdVRChatPhotoPathModelList: [],
    createdWorldJoinLogModelList: [],
    createdPlayerJoinLogModelList: [],
    createdPlayerLeaveLogModelList: [],
    // TODO: アプリイベントの処理は今後実装
    // createdAppEventCount: 0,
  };

  // 5. ログのバッチ処理
  const batchProcessStartTime = performance.now();
  const BATCH_SIZE = 1000;
  const totalBatches = Math.ceil(newLogs.length / BATCH_SIZE);

  for (let i = 0; i < newLogs.length; i += BATCH_SIZE) {
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const batchStartTime = performance.now();
    const batch = newLogs.slice(i, i + BATCH_SIZE);

    // 進捗を報告（5バッチごとまたは最初と最後）
    if (
      batchNumber === 1 ||
      batchNumber === totalBatches ||
      batchNumber % 5 === 0
    ) {
      emitStageProgress(
        'log_load',
        i + batch.length,
        newLogs.length,
        `ログデータを処理中... (${batchNumber}/${totalBatches})`,
      );
    }

    const worldJoinLogBatch = batch.filter(
      (log): log is VRChatWorldJoinLog => log.logType === 'worldJoin',
    );
    const playerJoinLogBatch = batch.filter(
      (log): log is VRChatPlayerJoinLog => log.logType === 'playerJoin',
    );
    const playerLeaveLogBatch = batch.filter(
      (log): log is VRChatPlayerLeaveLog => log.logType === 'playerLeave',
    );
    // TODO: アプリイベントの処理は今後実装
    // const appEventLogBatch = batch.filter(
    //   (
    //     log,
    //   ): log is VRChatAppStartLog | VRChatAppExitLog | VRChatAppVersionLog =>
    //     log.logType === 'appStart' ||
    //     log.logType === 'appExit' ||
    //     log.logType === 'appVersion',
    // );

    logger.debug(`worldJoinLogBatch: ${worldJoinLogBatch.length}`);
    logger.debug(`playerJoinLogBatch: ${playerJoinLogBatch.length}`);
    logger.debug(`playerLeaveLogBatch: ${playerLeaveLogBatch.length}`);
    // TODO: アプリイベントの処理は今後実装
    // logger.debug(`appEventLogBatch: ${appEventLogBatch.length}`);

    const dbInsertStartTime = performance.now();
    const [
      worldJoinResultsResult,
      playerJoinResults,
      playerLeaveResults,
      // TODO: アプリイベントの処理は今後実装
      // appEventResult,
    ] = await Promise.all([
      worldJoinLogService.createVRChatWorldJoinLogModel(worldJoinLogBatch),
      playerJoinLogService.createVRChatPlayerJoinLogModel(playerJoinLogBatch),
      playerLeaveLogService.createVRChatPlayerLeaveLogModel(
        playerLeaveLogBatch.map((logInfo) => ({
          leaveDate: logInfo.leaveDate,
          playerName: logInfo.playerName,
          playerId: logInfo.playerId ?? null,
        })),
      ),
      // TODO: アプリイベントの処理は今後実装
      // appEventLogBatch.length > 0
      //   ? appEventService.saveAppEventLogs(appEventLogBatch)
      //   : neverthrow.ok([]),
    ]);
    const dbInsertEndTime = performance.now();
    logger.debug(
      `Batch ${i / BATCH_SIZE + 1}: DB insert took ${
        dbInsertEndTime - dbInsertStartTime
      } ms`,
    );

    // DBエラーは予期しないエラーなのでthrowして上位に伝播（Sentryに送信される）
    if (worldJoinResultsResult.isErr()) {
      throw new Error(
        `Failed to save world join logs: ${worldJoinResultsResult.error.message}`,
      );
    }
    const worldJoinResults = worldJoinResultsResult.value;

    results.createdWorldJoinLogModelList =
      results.createdWorldJoinLogModelList.concat(worldJoinResults);
    results.createdPlayerJoinLogModelList =
      results.createdPlayerJoinLogModelList.concat(playerJoinResults);
    results.createdPlayerLeaveLogModelList =
      results.createdPlayerLeaveLogModelList.concat(playerLeaveResults);
    // TODO: アプリイベントの処理は今後実装
    // if (appEventResult.isOk()) {
    //   results.createdAppEventCount += appEventResult.value.length;
    // }

    const batchEndTime = performance.now();
    logger.debug(
      `Batch ${i / BATCH_SIZE + 1} processing took ${
        batchEndTime - batchStartTime
      } ms`,
    );

    // メモリ使用量をモニタリング（10バッチごと）
    if ((i / BATCH_SIZE + 1) % 10 === 0) {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      logger.debug(
        `Memory usage after batch ${i / BATCH_SIZE + 1}: Heap=${heapUsedMB.toFixed(2)}MB`,
      );

      // メモリ使用量が500MBを超えた場合は警告
      if (heapUsedMB > 500) {
        logger.warn(
          `High memory usage detected during log processing: ${heapUsedMB.toFixed(2)}MB`,
        );
      }
    }
  }
  const batchProcessEndTime = performance.now();
  logger.debug(
    `Total batch processing took ${
      batchProcessEndTime - batchProcessStartTime
    } ms`,
  );

  // 6. 写真のインデックス処理
  // excludeOldLogLoad=true → 差分スキャン（ダイジェスト・mtime使用）
  // excludeOldLogLoad=false → フルスキャン
  emitStageStart('photo_index', '写真をインデックス中...');
  const photoIndexStartTime = performance.now();
  const photoResults =
    await vrchatPhotoService.createVRChatPhotoPathIndex(excludeOldLogLoad);
  results.createdVRChatPhotoPathModelList = photoResults ?? [];
  const photoIndexEndTime = performance.now();
  logger.debug(
    `Create photo path index took ${
      photoIndexEndTime - photoIndexStartTime
    } ms`,
  );

  // 7. 写真フォルダからのログインポート（通常ログ処理後に実行）
  const importLogPhotoStartTime = performance.now();
  const vrChatPhotoDirPath = vrchatPhotoService.getVRChatPhotoDirPath();
  if (vrChatPhotoDirPath) {
    await vrchatLogService.importLogLinesFromLogPhotoDirPath({
      vrChatPhotoDirPath,
    });
  }
  const importLogPhotoEndTime = performance.now();
  logger.debug(
    `Import log lines from photo dir took ${
      importLogPhotoEndTime - importLogPhotoStartTime
    } ms`,
  );

  const totalEndTime = performance.now();
  logger.info(
    `loadLogInfoIndexFromVRChatLog finished. Total time: ${
      totalEndTime - totalStartTime
    } ms`,
  );

  return neverthrow.ok(results);
}

/**
 * 検索候補として利用可能なワールド名の一覧を取得する
 * @param query 検索クエリ（部分一致）
 * @param limit 最大件数
 * @returns 検索クエリに一致するワールド名の配列
 */
export const getWorldNameSuggestions = async (
  query: string,
  limit: number,
): Promise<neverthrow.Result<string[], never>> => {
  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  const worldJoinLogs = await VRChatWorldJoinLogModel.findAll({
    attributes: ['worldName'],
    where: {
      worldName: {
        [Op.like]: `%${query}%`,
      },
    },
    group: ['worldName'],
    order: [['worldName', 'ASC']],
    limit,
  });

  return neverthrow.ok(worldJoinLogs.map((log) => log.worldName));
};

/**
 * 検索候補として利用可能なプレイヤー名の一覧を取得する
 * @param query 検索クエリ（部分一致）
 * @param limit 最大件数
 * @returns 検索クエリに一致するプレイヤー名の配列
 */
export const getPlayerNameSuggestions = async (
  query: string,
  limit: number,
): Promise<neverthrow.Result<string[], never>> => {
  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  const playerJoinLogs = await VRChatPlayerJoinLogModel.findAll({
    attributes: ['playerName'],
    where: {
      playerName: {
        [Op.like]: `%${query}%`,
      },
    },
    group: ['playerName'],
    order: [['playerName', 'ASC']],
    limit,
  });

  return neverthrow.ok(playerJoinLogs.map((log) => log.playerName));
};

/**
 * よく遊ぶプレイヤー名のリストを取得する（頻度順）
 * @param limit 取得する最大件数
 * @returns よく遊ぶプレイヤー名の配列
 */
export const getFrequentPlayerNames = async (
  limit: number,
): Promise<neverthrow.Result<string[], never>> => {
  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  const playerCounts = await VRChatPlayerJoinLogModel.findAll({
    attributes: ['playerName', [fn('COUNT', col('playerName')), 'count']],
    group: ['playerName'],
    order: [[literal('count'), 'DESC']],
    limit,
  });

  return neverthrow.ok(playerCounts.map((player) => player.playerName));
};

/**
 * プレイヤー名で検索して、そのプレイヤーがいたセッションの参加日時を返す
 *
 * 効率的なサーバーサイド検索により、該当するセッションのみを返します。
 * これにより、フロントエンドは全データをフェッチする必要がなくなります。
 *
 * メモリ使用量を抑えるため、以下の最適化を行っています:
 * - プレイヤー検索結果に LIMIT を設定
 * - ワールドセッションを1回のクエリでバッチ取得（N+1問題を解決）
 * - 二分探索でインメモリマッチング
 * - 重複排除を効率的に行う
 *
 * @param playerName 検索するプレイヤー名（部分一致）
 * @param options.limit 検索するプレイヤー参加ログの最大件数（デフォルト: 1000）
 * @param options.maxSessions 返すセッションの最大件数（デフォルト: 100）
 * @returns 該当するセッションの参加日時の配列
 */
export const searchSessionsByPlayerName = async (
  playerName: string,
  options: { limit?: number; maxSessions?: number } = {},
): Promise<neverthrow.Result<Date[], never>> => {
  const startTime = performance.now();
  const { limit = 1000, maxSessions = 100 } = options;

  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  // プレイヤー名で部分一致検索（大文字小文字を区別しない）
  // LIMITを設定してメモリ使用量を抑える
  const playerJoinLogs = await VRChatPlayerJoinLogModel.findAll({
    attributes: ['joinDateTime'], // 必要なカラムのみ取得
    where: {
      playerName: {
        [Op.like]: `%${playerName}%`,
      },
    },
    order: [['joinDateTime', 'DESC']],
    limit,
  });

  if (playerJoinLogs.length === 0) {
    logger.debug(
      `searchSessionsByPlayerName: No players found for query "${playerName}"`,
    );
    return neverthrow.ok([]);
  }

  // プレイヤー参加日時を取得
  const playerJoinDates = playerJoinLogs.map((log) => log.joinDateTime);
  const maxPlayerJoinDate = playerJoinDates[0]; // DESC順なので最初が最大

  // N+1問題を解決: ワールド参加ログを1回のクエリでバッチ取得
  // プレイヤー参加日時以前のワールド参加ログをすべて取得
  const worldJoinLogs = await VRChatWorldJoinLogModel.findAll({
    attributes: ['joinDateTime'],
    where: {
      joinDateTime: {
        [Op.lte]: maxPlayerJoinDate,
      },
    },
    order: [['joinDateTime', 'DESC']],
    // 最大でプレイヤーログ数と同程度のワールドログがあると想定
    limit: limit * 2,
  });

  if (worldJoinLogs.length === 0) {
    logger.debug(
      `searchSessionsByPlayerName: No world join logs found before ${maxPlayerJoinDate.toISOString()}`,
    );
    return neverthrow.ok([]);
  }

  // ワールド参加ログを時系列順にソート（二分探索用）
  const sortedWorldJoinDates = worldJoinLogs
    .map((log) => log.joinDateTime)
    .sort((a, b) => a.getTime() - b.getTime());

  // 各プレイヤー参加日時に対して、対応するワールド参加日時を探す（インメモリ）
  const sessionJoinDates: Date[] = [];
  const processedWorldJoins = new Set<string>();

  for (const playerJoinDate of playerJoinDates) {
    if (sessionJoinDates.length >= maxSessions) {
      break;
    }

    // 二分探索でプレイヤー参加日時以下の最大のワールド参加日時を見つける
    const worldJoinDate = findLatestWorldJoinBefore(
      sortedWorldJoinDates,
      playerJoinDate,
    );

    if (worldJoinDate) {
      const worldJoinKey = worldJoinDate.toISOString();

      // 同じワールドセッションを重複して追加しないようにする
      if (!processedWorldJoins.has(worldJoinKey)) {
        processedWorldJoins.add(worldJoinKey);
        sessionJoinDates.push(worldJoinDate);
      }
    }
  }

  const endTime = performance.now();
  logger.debug(
    `searchSessionsByPlayerName: Found ${
      sessionJoinDates.length
    } unique sessions for player "${playerName}" in ${(
      endTime - startTime
    ).toFixed(
      2,
    )}ms (searched ${playerJoinLogs.length} player logs, ${worldJoinLogs.length} world logs)`,
  );

  // 新しい順にソートして返す
  return neverthrow.ok(
    sessionJoinDates.sort((a, b) => b.getTime() - a.getTime()),
  );
};

/**
 * 二分探索でtargetDate以下の最大の日時を見つける
 * @param sortedDates 昇順にソートされた日時配列
 * @param targetDate 検索対象の日時
 * @returns targetDate以下の最大の日時、見つからない場合はnull
 * @internal テスト用にexport
 */
export const findLatestWorldJoinBefore = (
  sortedDates: Date[],
  targetDate: Date,
): Date | null => {
  if (sortedDates.length === 0) {
    return null;
  }

  const targetTime = targetDate.getTime();

  // 最小値より小さい場合は見つからない
  if (targetTime < sortedDates[0].getTime()) {
    return null;
  }

  // 最大値以上の場合は最大値を返す
  if (targetTime >= sortedDates[sortedDates.length - 1].getTime()) {
    return sortedDates[sortedDates.length - 1];
  }

  // 二分探索
  let left = 0;
  let right = sortedDates.length - 1;

  while (left < right) {
    const mid = Math.ceil((left + right + 1) / 2);
    if (sortedDates[mid].getTime() <= targetTime) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }

  return sortedDates[left];
};
