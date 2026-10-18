import { performance } from 'node:perf_hooks';

import { col, fn, literal, Op } from '@sequelize/core';
import { buildWorldSessions, resolveSession } from '@shared/worldSession';
import * as datefns from 'date-fns';
import { Effect } from 'effect';
import { match } from 'ts-pattern';

import { getDBQueue } from '../../lib/dbQueue';
import { logger } from '../../lib/logger';
import type { InitProgressRun } from '../initProgress/emitter';
import type { InitProgressDetails } from '../initProgress/schema';
import type { VRChatLogFileError } from '../vrchatLog/error';
import type { VRChatLogError } from '../vrchatLog/errors';
import type { VRChatLogLine, VRChatLogStoreFilePath } from '../vrchatLog/model';
import type {
  VRChatPlayerJoinLog,
  VRChatPlayerLeaveLog,
  VRChatWorldJoinLog,
} from '../vrchatLog/service';
import * as vrchatLogService from '../vrchatLog/service';
import type { VRChatPhotoPathModel } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import * as vrchatPhotoService from '../vrchatPhoto/vrchatPhoto.service';
import type { PhotoIndexProgress } from '../vrchatPhoto/vrchatPhoto.service';
import * as metadataService from '../vrchatPhotoMetadata/service';
import { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import type { VRChatPlayerLeaveLogModel } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import * as playerLeaveLogService from '../VRChatPlayerLeaveLogModel/playerLeaveLog.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { findVRChatWorldJoinLogFromPhotoList } from '../vrchatWorldJoinLogFromPhoto/service';
import { LogInfoError } from './error';
import { type LogInfoServiceError, LogInfoUnknownError } from './errors';

/**
 * log_load ステージの進捗のうち、ログストアファイルの読み込みに割り当てる割合（%）。
 * 残りを DB 書き込みに割り当てる。全件同期では読み込みと書き込みがどちらも件数に比例して時間がかかり、
 * 書き込みの方が重いため、書き込みに多く割り当てる。
 */
const LOG_LOAD_READ_SHARE_PERCENT = 40;

/**
 * photo_index ステージの進捗の配分（%）。フォルダ一覧の探索・フォルダの走査（ダイジェスト比較と mtime 確認）・
 * 新規写真の登録の順に割り当てる。差分起動では新規写真が少なく探索と走査がステージの大半を占めるが、
 * 初回起動では全写真の画像サイズ読み取りと DB 登録の方が重いため、登録に多く割り当てる。
 * 探索は 1 フォルダあたり readdir 1 回で、走査（ダイジェスト計算と stat）より軽いため、走査より少なく割り当てる。
 */
const PHOTO_INDEX_LIST_SHARE_PERCENT = 10;
const PHOTO_INDEX_SCAN_SHARE_PERCENT = 20;
const PHOTO_INDEX_REGISTER_SHARE_PERCENT =
  100 - PHOTO_INDEX_LIST_SHARE_PERCENT - PHOTO_INDEX_SCAN_SHARE_PERCENT;

/**
 * createVRChatPhotoPathIndex の進捗を photo_index ステージの進捗へ変換して送る関数を作る。
 *
 * 探索と走査はフォルダ 1 つごとに通知されるため、写真フォルダが数千あると同じ割合のイベントが
 * 数千回送られる。そこで探索と走査は、送る割合（整数に丸めた値）が変わったときと段階が切り替わったとき、
 * 走査の最後のフォルダのときだけ送る。登録はバッチ単位で回数が少なく、撮影月の表示を毎回更新したいので間引かない。
 */
const createPhotoIndexProgressReporter = (progress: InitProgressRun) => {
  let lastSent: { phase: PhotoIndexProgress['phase']; percent: number } | null =
    null;
  const send = (
    phase: PhotoIndexProgress['phase'],
    percent: number,
    details: InitProgressDetails | undefined,
    force: boolean,
  ) => {
    const rounded = Math.round(percent);
    if (
      !force &&
      lastSent !== null &&
      lastSent.phase === phase &&
      lastSent.percent === rounded
    ) {
      return;
    }
    lastSent = { phase, percent: rounded };
    progress.stage('photo_index', percent, details);
  };

  return (photoProgress: PhotoIndexProgress): void => {
    match(photoProgress)
      .with(
        { phase: 'list' },
        ({ dirsListed, dirCount, topLevelListed, topLevelTotal }) => {
          // 探索中はフォルダの総数がまだ分からず、正直な件数を出せないので件数は送らない
          const dirsDone =
            dirsListed +
            (topLevelTotal > 0 ? topLevelListed / topLevelTotal : 0);
          send(
            'list',
            dirCount > 0
              ? (dirsDone / dirCount) * PHOTO_INDEX_LIST_SHARE_PERCENT
              : PHOTO_INDEX_LIST_SHARE_PERCENT,
            undefined,
            false,
          );
        },
      )
      .with({ phase: 'scan' }, ({ foldersScanned, totalFolders }) => {
        send(
          'scan',
          PHOTO_INDEX_LIST_SHARE_PERCENT +
            (totalFolders > 0 ? foldersScanned / totalFolders : 1) *
              PHOTO_INDEX_SCAN_SHARE_PERCENT,
          // フォルダが 1 つも無ければ件数を送らない。「0 / 0 フォルダ」と表示しても伝わる情報が無いため
          totalFolders > 0
            ? { current: foldersScanned, total: totalFolders, unit: 'folders' }
            : undefined,
          foldersScanned === totalFolders,
        );
      })
      .with({ phase: 'register' }, ({ handled, total, currentMonth }) => {
        send(
          'register',
          PHOTO_INDEX_LIST_SHARE_PERCENT +
            PHOTO_INDEX_SCAN_SHARE_PERCENT +
            (total > 0 ? handled / total : 1) *
              PHOTO_INDEX_REGISTER_SHARE_PERCENT,
          {
            current: handled,
            total,
            unit: 'photos',
            ...(currentMonth === undefined
              ? {}
              : { currentItem: currentMonth }),
          },
          true,
        );
        // バッチを登録するたびに月別グラフを伸ばす（送信は stats 側で間引かれる）
        progress.dbUpdated({ logsChanged: false });
      })
      .exhaustive();
  };
};

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
): Effect.Effect<VRChatLogStoreFilePath[], LogInfoServiceError> {
  return Effect.tryPromise({
    try: async () => {
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
          Effect.runPromise(worldJoinLogService.findLatestWorldJoinLog()),
          Effect.runPromise(playerJoinLogService.findLatestPlayerJoinLog()),
          playerLeaveLogService.findLatestPlayerLeaveLog(),
        ]);
        const findLatestEndTime = performance.now();
        logger.debug(
          `_getLogStoreFilePaths: Find latest logs took ${
            findLatestEndTime - findLatestStartTime
          } ms`,
        );

        const latestWorldJoinDate = latestWorldJoinDateResult;
        const latestPlayerJoinDate = latestPlayerJoinDateResult?.joinDateTime;

        // 最新の日時をフィルタリングしてソート
        const dates = [
          latestWorldJoinDate?.joinDateTime,
          latestPlayerJoinDate,
          latestPlayerLeaveDate?.leaveDateTime,
        ]
          .filter((d): d is Date => d instanceof Date) // Date型のみをフィルタリング
          .toSorted(datefns.compareAsc);
        logger.debug(
          `_getLogStoreFilePaths: latest dates: ${dates.map((d) => d.toISOString()).join(', ')}`,
        );

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
    },
    catch: (error) =>
      error instanceof LogInfoError
        ? new LogInfoUnknownError({ message: error.message })
        : new LogInfoUnknownError({
            message: error instanceof Error ? error.message : String(error),
          }),
  });
}

function _getLogStoreFilePaths(
  excludeOldLogLoad: boolean,
): Effect.Effect<VRChatLogStoreFilePath[], LogInfoServiceError> {
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
export function loadLogInfoIndexFromVRChatLog({
  excludeOldLogLoad = false,
  preLoadedLogLines,
  progress,
}: {
  excludeOldLogLoad?: boolean;
  /**
   * appendLoglinesToFileFromLogFilePathList で既に処理済みのログ行
   *
   * 背景: syncLogs の処理フローでは、step1（appendLoglines）で VRChat ログファイルを
   * 読み込んで logStore に書き込み、step2（loadLogInfo）で logStore を再読み込みする。
   * preLoadedLogLines を渡すことで step2 のファイル再読み込みをスキップし、
   * メモリ上のデータを直接使用して起動時間を短縮する。
   *
   * INCREMENTAL モード + preLoadedLogLines がある場合のみ最適化が適用される。
   * FULL モードではリカバリのため常にファイルから読み込む。
   */
  preLoadedLogLines?: VRChatLogLine[];
  /** log_load 以降のステージの進捗と DB 登録の通知を送る実行。実行に属さない呼び出しでは省く */
  progress?: InitProgressRun;
} = {}): Effect.Effect<
  LogProcessingResults,
  VRChatLogFileError | VRChatLogError | LogInfoError | LogInfoServiceError
> {
  return Effect.gen(function* () {
    const totalStartTime = performance.now();
    logger.info('loadLogInfoIndexFromVRChatLog start');

    // log_load の進捗のうち、DB 書き込みが始まる位置。ログストアの読み込みがあれば
    // その分（LOG_LOAD_READ_SHARE_PERCENT）を先に使い、無ければ 0 から書き込みに充てる
    let insertProgressBase = 0;

    let logInfoList: ReturnType<
      typeof vrchatLogService.convertLogLinesToWorldAndPlayerJoinLogInfos
    >['logInfos'];

    // INCREMENTAL モードで処理済みログ行がある場合、ファイル再読み込みをスキップ
    if (
      excludeOldLogLoad &&
      preLoadedLogLines &&
      preLoadedLogLines.length > 0
    ) {
      const parseStartTime = performance.now();
      logger.info(
        `Using ${preLoadedLogLines.length} pre-loaded log lines (skipping file read)`,
      );
      progress?.stage('log_load', 0);
      const parseResult =
        vrchatLogService.convertLogLinesToWorldAndPlayerJoinLogInfos(
          preLoadedLogLines,
        );
      logInfoList = parseResult.logInfos;
      const parseEndTime = performance.now();
      logger.debug(
        `Parse pre-loaded log lines took ${parseEndTime - parseStartTime} ms`,
      );
    } else {
      // 1. 処理対象となるログファイルパスを取得
      const getLogPathsStartTime = performance.now();
      const logStoreFilePaths = yield* _getLogStoreFilePaths(excludeOldLogLoad);
      const getLogPathsEndTime = performance.now();
      logger.debug(
        `Get log store file paths took ${
          getLogPathsEndTime - getLogPathsStartTime
        } ms`,
      );
      logger.info(
        `loadLogInfoIndexFromVRChatLog excludeOldLogLoad: ${String(excludeOldLogLoad)} target: ${logStoreFilePaths.map((path) => path.value).join(', ')}`,
      );

      // 3. ログファイルからログ情報を取得（部分的な成功を許容）
      logger.info(`start log file read: ${logStoreFilePaths.length} files`);
      const reportFilesRead = (filesRead: number, totalFiles: number) => {
        progress?.stage(
          'log_load',
          totalFiles > 0
            ? (filesRead / totalFiles) * LOG_LOAD_READ_SHARE_PERCENT
            : LOG_LOAD_READ_SHARE_PERCENT,
          { current: filesRead, total: totalFiles, unit: 'files' },
        );
      };
      reportFilesRead(0, logStoreFilePaths.length);
      const getLogInfoStartTime = performance.now();
      // この関数は never エラーなので常に成功
      const logInfoListFromLogFile =
        yield* vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess(
          logStoreFilePaths,
          { onFilesRead: reportFilesRead },
        );
      insertProgressBase = LOG_LOAD_READ_SHARE_PERCENT;
      const getLogInfoEndTime = performance.now();
      logger.info(
        `done log file read: ${(getLogInfoEndTime - getLogInfoStartTime).toFixed(0)} ms`,
      );

      // エラーがあった場合は警告を出力し、Sentryにも送信
      if (logInfoListFromLogFile.errorCount > 0) {
        const errorSummary = `Failed to process ${logInfoListFromLogFile.errorCount} log files out of ${logInfoListFromLogFile.totalProcessed}`;
        const errorDetails = logInfoListFromLogFile.errors.map((e) => ({
          path: e.path,
          code: '_tag' in e.error ? e.error._tag : e.error.code,
        }));

        logger.warnWithSentry({
          message: errorSummary,
          details: { errorDetails },
        });
      }

      // 成功したログが1つもない場合のみエラーを返す
      if (
        logInfoListFromLogFile.successCount === 0 &&
        logInfoListFromLogFile.errorCount > 0
      ) {
        return yield* Effect.fail(logInfoListFromLogFile.errors[0].error);
      }

      logInfoList = logInfoListFromLogFile.data;
    }

    logger.info(
      `start log filtering: ${logInfoList.length} logs, excludeOldLogLoad=${String(excludeOldLogLoad)}`,
    );
    const filterLogsStartTime = performance.now();
    const newLogs = yield* Effect.promise(() =>
      match(excludeOldLogLoad)
        // DBの最新日時以降のログのみをフィルタリング
        .with(true, async () => {
          const findLatestStartTime = performance.now();
          // ログの最新日時を取得
          const [
            latestWorldJoinDate,
            latestPlayerJoinDate,
            latestPlayerLeaveDate,
          ] = await Promise.all([
            Effect.runPromise(worldJoinLogService.findLatestWorldJoinLog()),
            Effect.runPromise(playerJoinLogService.findLatestPlayerJoinLog()),
            playerLeaveLogService.findLatestPlayerLeaveLog(),
          ]);
          const findLatestEndTime = performance.now();
          logger.debug(
            `Filtering: Find latest logs took ${
              findLatestEndTime - findLatestStartTime
            } ms`,
          );

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
        .exhaustive(),
    );
    const filterLogsEndTime = performance.now();
    logger.info(
      `done log filtering: ${newLogs.length} logs to insert (${(filterLogsEndTime - filterLogsStartTime).toFixed(0)} ms)`,
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
    // 全バッチを1トランザクションで囲み、WAL sync を1回に集約して I/O を削減する。
    const batchProcessStartTime = performance.now();
    const BATCH_SIZE = 5000;
    const totalBatches = Math.ceil(newLogs.length / BATCH_SIZE);
    logger.info(
      `start DB batch insert: ${newLogs.length} logs (${totalBatches} batches)`,
    );
    const reportLogsInserted = (inserted: number) => {
      progress?.stage(
        'log_load',
        newLogs.length > 0
          ? insertProgressBase +
              (inserted / newLogs.length) * (100 - insertProgressBase)
          : 100,
        { current: inserted, total: newLogs.length, unit: 'logs' },
      );
    };
    reportLogsInserted(0);

    // DB Queue の transaction() を使い、書き込みをキュー経由でシリアライズする。
    // Sequelize の managed transaction により自動 commit/rollback される。
    // DBQueueError は予期しないエラー（DB接続断等）なので defect として Sentry に送信する。
    yield* getDBQueue()
      .transaction(async (transaction) => {
        for (let i = 0; i < newLogs.length; i += BATCH_SIZE) {
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
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

          const worldJoinResults = await Effect.runPromise(
            worldJoinLogService.createVRChatWorldJoinLogModel(
              worldJoinLogBatch,
              { transaction },
            ),
          );
          const playerJoinResults = await Effect.runPromise(
            playerJoinLogService.createVRChatPlayerJoinLogModel(
              playerJoinLogBatch,
              { transaction },
            ),
          );
          const playerLeaveResults =
            await playerLeaveLogService.createVRChatPlayerLeaveLogModel(
              playerLeaveLogBatch.map((logInfo) => ({
                leaveDate: logInfo.leaveDate,
                playerName: logInfo.playerName,
                playerId: logInfo.playerId ?? null,
              })),
              { transaction },
            );

          results.createdWorldJoinLogModelList.push(...worldJoinResults);
          results.createdPlayerJoinLogModelList.push(...playerJoinResults);
          results.createdPlayerLeaveLogModelList.push(...playerLeaveResults);

          // 進捗をUIプログレスバーに反映（毎バッチ）
          reportLogsInserted(i + batch.length);
          logger.debug(`log batch inserted: ${batchNumber}/${totalBatches}`);
        }
      }, 'logInfo.batchInsert')
      .pipe(Effect.orDie);
    const batchProcessEndTime = performance.now();
    logger.info(
      `done DB batch insert: ${(batchProcessEndTime - batchProcessStartTime).toFixed(0)} ms`,
    );
    // 書き込みが 0 件でもステージを完了させる（コミット後なのでワールド数・人数も更新できる）
    reportLogsInserted(newLogs.length);
    progress?.dbUpdated({ logsChanged: true });

    // 6. 写真のインデックス処理
    // excludeOldLogLoad=true → 差分スキャン（ダイジェスト・mtime使用）
    // excludeOldLogLoad=false → フルスキャン
    logger.info('start photo index creation');
    progress?.stage('photo_index', 0);
    const photoIndexStartTime = performance.now();
    const photoResults = yield* Effect.promise(() =>
      vrchatPhotoService.createVRChatPhotoPathIndex(
        excludeOldLogLoad,
        progress === undefined
          ? undefined
          : createPhotoIndexProgressReporter(progress),
      ),
    );
    results.createdVRChatPhotoPathModelList = photoResults ?? [];
    progress?.stage('photo_index', 100);
    const photoIndexEndTime = performance.now();
    logger.info(
      `done photo index creation: ${photoResults?.length ?? 0} photos (${(photoIndexEndTime - photoIndexStartTime).toFixed(0)} ms)`,
    );

    // 6.5. 写真メタデータ抽出 (VRChat公式XMP)
    if (photoResults && photoResults.length > 0) {
      logger.info(
        `start photo metadata extraction: ${photoResults.length} photos`,
      );
      const metadataStartTime = performance.now();
      const photoPaths = photoResults.map((p) => p.photoPath);
      const reportMetadataProgress = (processed: number, total: number) => {
        progress?.stage(
          'photo_metadata',
          total > 0 ? (processed / total) * 100 : 100,
          { current: processed, total, unit: 'photos' },
        );
      };
      reportMetadataProgress(0, photoPaths.length);
      const metadataResult = yield* Effect.either(
        metadataService.extractAndSaveMetadataBatch(photoPaths, {
          onProgress: reportMetadataProgress,
        }),
      );
      // DB エラーで途中終了した場合も、このステージの処理は終わっているので完了にする
      reportMetadataProgress(photoPaths.length, photoPaths.length);
      if (metadataResult._tag === 'Right') {
        logger.info(
          `Photo metadata extracted: ${metadataResult.right} new records`,
        );
      } else {
        // MetadataDbError は予期しないエラーなので error レベル（Sentry送信）
        logger.error({
          message: `Photo metadata DB error: ${metadataResult.left.message}`,
          stack: metadataResult.left,
        });
      }
      const metadataEndTime = performance.now();
      logger.info(
        `done photo metadata extraction: ${(metadataEndTime - metadataStartTime).toFixed(0)} ms`,
      );
    }

    // 7. 写真フォルダからのログインポート（通常ログ処理後に実行）
    logger.info('start photo dir log import');
    progress?.stage('photo_log_import', 0);
    const importLogPhotoStartTime = performance.now();
    const vrChatPhotoDirPath = vrchatPhotoService.getVRChatPhotoDirPath();
    if (vrChatPhotoDirPath) {
      yield* Effect.promise(() =>
        vrchatLogService.importLogLinesFromLogPhotoDirPath({
          vrChatPhotoDirPath,
        }),
      );
    }
    progress?.stage('photo_log_import', 100);
    const importLogPhotoEndTime = performance.now();
    logger.info(
      `done photo dir log import: ${(importLogPhotoEndTime - importLogPhotoStartTime).toFixed(0)} ms`,
    );

    const totalEndTime = performance.now();
    logger.info(
      `loadLogInfoIndexFromVRChatLog finished. Total time: ${
        totalEndTime - totalStartTime
      } ms`,
    );

    return results;
  });
}

/**
 * 検索候補として利用可能なワールド名の一覧を取得する
 * @param query 検索クエリ（部分一致）
 * @param limit 最大件数
 * @returns 検索クエリに一致するワールド名の配列
 */
export const getWorldNameSuggestions = (
  query: string,
  limit: number,
): Effect.Effect<string[]> => {
  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  return Effect.promise(async () => {
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

    return worldJoinLogs.map((log) => log.worldName);
  });
};

/**
 * 検索候補として利用可能なプレイヤー名の一覧を取得する
 * @param query 検索クエリ（部分一致）
 * @param limit 最大件数
 * @returns 検索クエリに一致するプレイヤー名の配列
 */
export const getPlayerNameSuggestions = (
  query: string,
  limit: number,
): Effect.Effect<string[]> => {
  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  return Effect.promise(async () => {
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

    return playerJoinLogs.map((log) => log.playerName);
  });
};

/**
 * よく遊ぶプレイヤー名のリストを取得する（頻度順）
 * @param limit 取得する最大件数
 * @returns よく遊ぶプレイヤー名の配列
 */
export const getFrequentPlayerNames = (
  limit: number,
): Effect.Effect<string[]> => {
  // データベースエラーは予期しないエラーなので、try-catchせずに上位に伝播
  return Effect.promise(async () => {
    const playerCounts = await VRChatPlayerJoinLogModel.findAll({
      attributes: ['playerName', [fn('COUNT', col('playerName')), 'count']],
      group: ['playerName'],
      order: [[literal('count'), 'DESC']],
      limit,
    });

    return playerCounts.map((player) => player.playerName);
  });
};

/**
 * 通常のワールド参加ログと写真由来の参加ログを取得し、マージして並べる
 *
 * ワールドセッションの判定（`@shared/worldSession`）に渡す参加ログの取得元。
 * 写真のグループ化と同じく、通常ログと写真由来ログを `mergeVRChatWorldJoinLogs`
 * でマージした列を使うことで、プレイヤー一覧・検索とギャラリーの区切りを揃える。
 *
 * 予期しないエラーのみ発生するため、Effect の defect として伝播する。
 * E チャネルは never（型付きエラーなし）。
 *
 * @param searchParams - ログ検索パラメーター（gt / lt はどちらも境界を含まない）。
 *   limit は通常ログと写真由来ログのそれぞれに orderByJoinDateTime の順で適用するため、
 *   マージ後の件数は最大で limit の 2 倍になる
 * @param sortOrder - ソート順序（'desc' = 降順、'asc' = 昇順）
 * @returns ソート済みの統合ログ配列
 */
export const fetchAndMergeSortedWorldJoinLogs = (
  searchParams: {
    ltJoinDateTime?: Date;
    gtJoinDateTime?: Date;
    orderByJoinDateTime: 'asc' | 'desc';
    limit?: number;
  },
  sortOrder: 'desc' | 'asc' = 'desc',
): Effect.Effect<
  {
    id: string;
    worldId: string;
    worldName: string;
    worldInstanceId: string;
    joinDateTime: Date;
    createdAt: Date;
    updatedAt: Date | null;
  }[]
> =>
  Effect.promise(async () => {
    // 通常ログとPhotoAsLogを並行取得
    const [normalLogs, photoLogs] = await Promise.all([
      worldJoinLogService.findVRChatWorldJoinLogList(searchParams),
      findVRChatWorldJoinLogFromPhotoList(searchParams),
    ]);

    logger.debug({
      message: 'World join logs retrieved',
      normalLogsCount: normalLogs.length,
      photoLogsCount: photoLogs.length,
    });

    const mergedLogs = worldJoinLogService.mergeVRChatWorldJoinLogs({
      normalLogs: normalLogs,
      photoLogs: photoLogs,
    });

    return mergedLogs.toSorted((a, b) =>
      sortOrder === 'desc'
        ? b.joinDateTime.getTime() - a.joinDateTime.getTime()
        : a.joinDateTime.getTime() - b.joinDateTime.getTime(),
    );
  });

/**
 * プレイヤー名で検索して、そのプレイヤーがいたセッションの参加日時を返す
 *
 * 各プレイヤー参加日時を `@shared/worldSession` の判定でセッションへ対応付け、
 * セッションの開始日時を返す。参加ログは通常ログと写真由来ログのマージ済みの列を
 * 使うため、返す日時はギャラリーのグループの joinDateTime と一致する。
 *
 * メモリ使用量を抑えるため、プレイヤー検索結果に LIMIT を設定し、
 * セッション判定は二分探索でインメモリに行う。
 *
 * @param playerName 検索するプレイヤー名（部分一致）
 * @param options.limit 検索するプレイヤー参加ログの最大件数（デフォルト: 1000）
 * @param options.maxSessions 返すセッションの最大件数（デフォルト: 100）
 * @returns 該当するセッションの開始日時の配列（新しい順）
 */
export const searchSessionsByPlayerName = (
  playerName: string,
  options: { limit?: number; maxSessions?: number } = {},
): Effect.Effect<Date[]> =>
  Effect.gen(function* () {
    const startTime = performance.now();
    const { limit = 1000, maxSessions = 100 } = options;

    // データベースエラーは予期しないエラーなので defect として上位に伝播
    // プレイヤー名で部分一致検索（大文字小文字を区別しない）
    const playerJoinLogs = yield* Effect.promise(() =>
      VRChatPlayerJoinLogModel.findAll({
        attributes: ['joinDateTime'],
        where: {
          playerName: {
            [Op.like]: `%${playerName}%`,
          },
        },
        order: [['joinDateTime', 'DESC']],
        limit,
      }),
    );

    if (playerJoinLogs.length === 0) {
      logger.debug(
        `searchSessionsByPlayerName: No players found for query "${playerName}"`,
      );
      return [];
    }

    // DESC 順なので先頭が最新、末尾が最古。判定に要る参加ログは、プレイヤー参加日時の
    // 範囲 [最古, 最新] にあるものと、最古より前で最も新しいもの（最古の参加日時が属する
    // セッションの開始）だけなので、履歴全体を読まずにこの 2 つだけを取得する。
    // gt / lt は境界を含まないため、1ms 広げて範囲の端ちょうどの参加ログを含める
    const playerJoinDates = playerJoinLogs.map((log) => log.joinDateTime);
    const maxPlayerJoinDate = playerJoinDates[0];
    const minPlayerJoinDate = playerJoinDates[playerJoinDates.length - 1];

    const [logsInRange, logsBeforeRange] = yield* Effect.all([
      fetchAndMergeSortedWorldJoinLogs(
        {
          gtJoinDateTime: new Date(minPlayerJoinDate.getTime() - 1),
          ltJoinDateTime: new Date(maxPlayerJoinDate.getTime() + 1),
          orderByJoinDateTime: 'asc',
        },
        'asc',
      ),
      fetchAndMergeSortedWorldJoinLogs(
        {
          ltJoinDateTime: minPlayerJoinDate,
          orderByJoinDateTime: 'desc',
          limit: 1,
        },
        'desc',
      ),
    ]);
    // 直前の参加ログは通常ログと写真由来ログから 1 件ずつ取るため最大 2 件になる。
    // 返すのはセッションの開始日時だけなので、最も新しい日時を持つものを残せば足りる
    const latestBeforeRange = logsBeforeRange[0]?.joinDateTime.getTime();
    const precedingJoins = logsBeforeRange.filter(
      (log) => log.joinDateTime.getTime() === latestBeforeRange,
    );
    const worldJoinLogs = [...precedingJoins, ...logsInRange];
    const sessions = buildWorldSessions(worldJoinLogs);

    const sessionJoinDates: Date[] = [];
    const processedSessionKeys = new Set<number>();

    for (const playerJoinDate of playerJoinDates) {
      if (sessionJoinDates.length >= maxSessions) {
        break;
      }
      const session = resolveSession(sessions, playerJoinDate);
      if (session === null) {
        continue;
      }
      const sessionStart = session.join.joinDateTime;
      // 同じワールドセッションを重複して追加しないようにする
      if (!processedSessionKeys.has(sessionStart.getTime())) {
        processedSessionKeys.add(sessionStart.getTime());
        sessionJoinDates.push(sessionStart);
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
    return sessionJoinDates.toSorted((a, b) => b.getTime() - a.getTime());
  });
