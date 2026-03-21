import { Effect } from 'effect';
import { match } from 'ts-pattern';
import type {
  VRChatLogFilePath,
  VRChatLogFilesDirPath,
} from '../vrchatLogFileDir/model';
import * as vrchatLogFileDirService from '../vrchatLogFileDir/service';
import { FILTER_PATTERNS } from './constants/logPatterns';
import type { VRChatLogFileError } from './error';
import { LogFileDirNotFound, type VRChatLogError } from './errors';
import type { VRChatLogStoreFilePath } from './model';

// パーサー機能のインポート
import {
  convertLogLinesToWorldAndPlayerJoinLogInfos,
  extractPlayerJoinInfoFromLog,
  filterLogLinesByDate,
  type VRChatPlayerJoinLog,
  type VRChatPlayerLeaveLog,
  type VRChatWorldJoinLog,
  type VRChatWorldLeaveLog,
} from './parsers';
// TODO: アプリイベントの型は今後実装
// import type {
//   VRChatAppExitLog,
//   VRChatAppStartLog,
// } from './parsers/appEventParser';

// ファイルハンドラー機能のインポート
import {
  appendLoglinesToFile,
  getLegacyLogStoreFilePath,
  getLogLinesByLogFilePathList,
  getLogLinesByLogFilePathListStreaming,
  getLogLinesByLogFilePathListWithPartialSuccess,
  getLogStoreFilePathForDate,
  getLogStoreFilePathsInRange,
  importLogLinesFromLogPhotoDirPath,
} from './fileHandlers';
import type { PartialSuccessResult } from './types/partialSuccess';

/**
 * VRChatログサービスのメインインターフェース
 * ログファイルの処理と情報抽出を提供
 */

/**
 * 指定されたログディレクトリからVRChatログ情報を取得
 * @param logFilesDir VRChatログファイルのディレクトリパス
 * @returns ワールド参加・プレイヤー参加/退出ログの配列
 */
export const getVRChaLogInfoFromLogPath = (
  logFilesDir: VRChatLogFilesDirPath,
): Effect.Effect<
  (
    | VRChatWorldJoinLog
    | VRChatWorldLeaveLog
    | VRChatPlayerJoinLog
    | VRChatPlayerLeaveLog
  )[],
  // TODO: アプリイベントの型は今後実装
  // | VRChatAppStartLog
  // | VRChatAppExitLog
  VRChatLogFileError | VRChatLogError
> =>
  Effect.gen(function* () {
    const logFilePathList = yield* vrchatLogFileDirService
      .getVRChatLogFilePathList(logFilesDir)
      .pipe(
        Effect.mapError((fsError) =>
          match(fsError)
            .with(
              'ENOENT',
              () =>
                new LogFileDirNotFound({
                  message: 'VRChat log file directory not found',
                }),
            )
            .exhaustive(),
        ),
      );

    const logInfoList =
      yield* getVRChaLogInfoByLogFilePathList(logFilePathList);

    return logInfoList;
  });

/**
 * ログファイルパスのリストからVRChatログ情報を取得
 * @param logFilePathList ログファイルパスの配列
 * @returns ワールド参加・プレイヤー参加/退出ログの配列
 */
export const getVRChaLogInfoByLogFilePathList = (
  logFilePathList: (VRChatLogFilePath | VRChatLogStoreFilePath)[],
): Effect.Effect<
  (
    | VRChatWorldJoinLog
    | VRChatWorldLeaveLog
    | VRChatPlayerJoinLog
    | VRChatPlayerLeaveLog
  )[],
  // TODO: アプリイベントの型は今後実装
  // | VRChatAppStartLog
  // | VRChatAppExitLog
  VRChatLogFileError | VRChatLogError
> =>
  Effect.gen(function* () {
    const logLineList = yield* getLogLinesByLogFilePathList({
      logFilePathList,
      includesList: [...FILTER_PATTERNS],
    });

    const parseResult =
      convertLogLinesToWorldAndPlayerJoinLogInfos(logLineList);

    // エラーがあってもログ情報は返す（部分的な成功を許容）
    return parseResult.logInfos;
  });

export type LogInfoPartialSuccessResult = PartialSuccessResult<
  (
    | VRChatWorldJoinLog
    | VRChatWorldLeaveLog
    | VRChatPlayerJoinLog
    | VRChatPlayerLeaveLog
  )[],
  { path: string; error: VRChatLogFileError | VRChatLogError }
>;

/**
 * 複数のVRChatログファイルからログ情報を取得（部分的な成功を許容）
 * エラーが発生しても処理を継続し、成功した部分のデータを返す
 * @param logFilePathList ログファイルパスのリスト
 * @returns 部分的な成功結果（成功したログ情報とエラー情報）
 */
export const getVRChaLogInfoByLogFilePathListWithPartialSuccess = (
  logFilePathList: (VRChatLogFilePath | VRChatLogStoreFilePath)[],
): Effect.Effect<LogInfoPartialSuccessResult, never> =>
  Effect.tryPromise({
    try: async (): Promise<LogInfoPartialSuccessResult> => {
      const logLineListResult =
        await getLogLinesByLogFilePathListWithPartialSuccess({
          logFilePathList,
          includesList: [...FILTER_PATTERNS],
        });

      const parseResult = convertLogLinesToWorldAndPlayerJoinLogInfos(
        logLineListResult.data,
      );

      return {
        data: parseResult.logInfos,
        errors: logLineListResult.errors,
        totalProcessed: logLineListResult.totalProcessed,
        successCount: logLineListResult.successCount,
        errorCount: logLineListResult.errorCount,
      };
    },
    catch: (e) => {
      // Error type is `never` - unexpected errors should propagate
      throw e;
    },
  }) as Effect.Effect<LogInfoPartialSuccessResult, never>;

// ファイルハンドラー機能の再エクスポート
export {
  getLogLinesByLogFilePathList,
  getLogLinesByLogFilePathListStreaming,
  getLogStoreFilePathForDate,
  getLegacyLogStoreFilePath,
  getLogStoreFilePathsInRange,
  appendLoglinesToFile,
  importLogLinesFromLogPhotoDirPath,
};

// 型定義の再エクスポート
export type {
  VRChatWorldJoinLog,
  VRChatWorldLeaveLog,
  VRChatPlayerJoinLog,
  VRChatPlayerLeaveLog,
  // TODO: アプリイベントの型は今後実装
  // VRChatAppStartLog,
  // VRChatAppExitLog,
};

// パーサー機能の再エクスポート
export { extractPlayerJoinInfoFromLog, filterLogLinesByDate };
