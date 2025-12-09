import { performance } from 'node:perf_hooks';
import { Op, col, fn, literal } from '@sequelize/core';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { logger } from '../../lib/logger';
import { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import type { VRChatPlayerLeaveLogModel } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import * as playerLeaveLogService from '../VRChatPlayerLeaveLogModel/playerLeaveLog.service';
import type { VRChatLogFileError } from '../vrchatLog/error';
import type { VRChatLogStoreFilePath } from '../vrchatLog/model';
import * as vrchatLogService from '../vrchatLog/service';
import type {
  VRChatPlayerJoinLog,
  VRChatPlayerLeaveLog,
  VRChatWorldJoinLog,
} from '../vrchatLog/service';
import type { VRChatPhotoPathModel } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import * as vrchatPhotoService from '../vrchatPhoto/vrchatPhoto.service';
import { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';

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
async function _getLogStoreFilePathsImpl(
  excludeOldLogLoad: boolean,
): Promise<VRChatLogStoreFilePath[]> {
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

    const latestWorldJoinDate = latestWorldJoinDateResult.isOk()
      ? latestWorldJoinDateResult.value
      : null;

    const latestPlayerJoinDate = latestPlayerJoinDateResult.isOk()
      ? latestPlayerJoinDateResult.value?.joinDateTime
      : null;

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
}

function _getLogStoreFilePaths(
  excludeOldLogLoad: boolean,
): ResultAsync<VRChatLogStoreFilePath[], never> {
  return ResultAsync.fromSafePromise(
    _getLogStoreFilePathsImpl(excludeOldLogLoad),
  );
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
} = {}): Promise<neverthrow.Result<LogProcessingResults, VRChatLogFileError>> {
  const totalStartTime = performance.now();
  logger.info('loadLogInfoIndexFromVRChatLog start');

  // 1. 処理対象となるログファイルパスを取得
  const getLogPathsStartTime = performance.now();
  const logStoreFilePathsResult =
    await _getLogStoreFilePaths(excludeOldLogLoad);
  // _getLogStoreFilePaths は never エラーなので常に成功
  const logStoreFilePaths = logStoreFilePathsResult._unsafeUnwrap();
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

      // latestWorldJoinDateResultからvalueを取得
      const latestWorldJoinDate = latestWorldJoinDateResult.isOk()
        ? latestWorldJoinDateResult.value
        : null;

      // playerJoinDateResultからvalueを取得
      let latestPlayerJoinDate = null;
      if (latestPlayerJoinDateResult.isOk()) {
        latestPlayerJoinDate = latestPlayerJoinDateResult.value;
      }

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
  for (let i = 0; i < newLogs.length; i += BATCH_SIZE) {
    const batchStartTime = performance.now();
    const batch = newLogs.slice(i, i + BATCH_SIZE);

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
          playerName: logInfo.playerName.value,
          playerId: logInfo.playerId?.value ?? null,
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

    // worldJoinResultsResultがResultAsyncなので展開
    const worldJoinResults = worldJoinResultsResult.isOk()
      ? worldJoinResultsResult.value
      : [];
    if (worldJoinResultsResult.isErr()) {
      logger.error({
        message: 'ワールド参加ログのDB保存中にエラーが発生しました',
        stack: new Error(JSON.stringify(worldJoinResultsResult.error)),
      });
    }

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
  }
  const batchProcessEndTime = performance.now();
  logger.debug(
    `Total batch processing took ${
      batchProcessEndTime - batchProcessStartTime
    } ms`,
  );

  // 6. 写真のインデックス処理
  const photoIndexStartTime = performance.now();
  const latestPhotoDate = await match(excludeOldLogLoad)
    .with(true, async () => await vrchatPhotoService.getLatestPhotoDate())
    .with(false, () => null)
    .exhaustive();
  const photoResults =
    await vrchatPhotoService.createVRChatPhotoPathIndex(latestPhotoDate);
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
 * @param playerName 検索するプレイヤー名（部分一致）
 * @returns 該当するセッションの参加日時の配列
 */
export const searchSessionsByPlayerName = async (
  playerName: string,
): Promise<neverthrow.Result<Date[], never>> => {
  const startTime = performance.now();

  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  // プレイヤー名で部分一致検索（大文字小文字を区別しない）
  const playerJoinLogs = await VRChatPlayerJoinLogModel.findAll({
    where: {
      playerName: {
        [Op.like]: `%${playerName}%`,
      },
    },
    order: [['joinDateTime', 'DESC']],
  });

  if (playerJoinLogs.length === 0) {
    logger.debug(
      `searchSessionsByPlayerName: No players found for query "${playerName}"`,
    );
    return neverthrow.ok([]);
  }

  // 各プレイヤー参加ログに対して、対応するワールド参加ログを探す
  const sessionJoinDates: Date[] = [];
  const processedWorldJoins = new Set<string>();

  for (const playerLog of playerJoinLogs) {
    // このプレイヤーが参加した時点での最新のワールド参加ログを取得
    const worldJoinLog = await VRChatWorldJoinLogModel.findOne({
      where: {
        joinDateTime: {
          [Op.lte]: playerLog.joinDateTime,
        },
      },
      order: [['joinDateTime', 'DESC']],
    });

    if (worldJoinLog) {
      const worldJoinKey = worldJoinLog.joinDateTime.toISOString();

      // 同じワールドセッションを重複して追加しないようにする
      if (!processedWorldJoins.has(worldJoinKey)) {
        processedWorldJoins.add(worldJoinKey);
        sessionJoinDates.push(worldJoinLog.joinDateTime);
      }
    }
  }

  const endTime = performance.now();
  logger.debug(
    `searchSessionsByPlayerName: Found ${
      sessionJoinDates.length
    } unique sessions for player "${playerName}" in ${(
      endTime - startTime
    ).toFixed(2)}ms`,
  );

  // 新しい順にソートして返す
  return neverthrow.ok(
    sessionJoinDates.sort((a, b) => b.getTime() - a.getTime()),
  );
};
