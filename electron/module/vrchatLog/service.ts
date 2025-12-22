import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  VRChatLogFilePath,
  VRChatLogFilesDirPath,
} from '../vrchatLogFileDir/model';
import * as vrchatLogFileDirService from '../vrchatLogFileDir/service';
import { VRChatLogFileError } from './error';
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
export const getVRChaLogInfoFromLogPath = async (
  logFilesDir: VRChatLogFilesDirPath,
): Promise<
  neverthrow.Result<
    (
      | VRChatWorldJoinLog
      | VRChatWorldLeaveLog
      | VRChatPlayerJoinLog
      | VRChatPlayerLeaveLog
    )[],
    // TODO: アプリイベントの型は今後実装
    // | VRChatAppStartLog
    // | VRChatAppExitLog
    VRChatLogFileError
  >
> => {
  const logFilePathList =
    await vrchatLogFileDirService.getVRChatLogFilePathList(logFilesDir);

  if (logFilePathList.isErr()) {
    return neverthrow.err(
      match(logFilePathList.error)
        .with('ENOENT', () => new VRChatLogFileError('LOG_FILE_DIR_NOT_FOUND'))
        .exhaustive(),
    );
  }

  const logInfoList = await getVRChaLogInfoByLogFilePathList(
    logFilePathList.value,
  );

  if (logInfoList.isErr()) {
    return neverthrow.err(logInfoList.error);
  }

  return neverthrow.ok(logInfoList.value);
};

/**
 * ログファイルパスのリストからVRChatログ情報を取得
 * @param logFilePathList ログファイルパスの配列
 * @returns ワールド参加・プレイヤー参加/退出ログの配列
 */
export const getVRChaLogInfoByLogFilePathList = async (
  logFilePathList: (VRChatLogFilePath | VRChatLogStoreFilePath)[],
): Promise<
  neverthrow.Result<
    (
      | VRChatWorldJoinLog
      | VRChatWorldLeaveLog
      | VRChatPlayerJoinLog
      | VRChatPlayerLeaveLog
    )[],
    // TODO: アプリイベントの型は今後実装
    // | VRChatAppStartLog
    // | VRChatAppExitLog
    VRChatLogFileError
  >
> => {
  const logLineList = await getLogLinesByLogFilePathList({
    logFilePathList,
    includesList: [
      'VRC Analytics Initialized', // TODO: 今後実装
      '[Behaviour] Joining ',
      '[Behaviour] OnPlayerJoined ',
      '[Behaviour] OnPlayerLeft ',
      'VRCApplication: HandleApplicationQuit', // worldLeaveParserで処理
    ],
  });

  if (logLineList.isErr()) {
    return neverthrow.err(logLineList.error);
  }

  const parseResult = convertLogLinesToWorldAndPlayerJoinLogInfos(
    logLineList.value,
  );

  // エラーがあってもログ情報は返す（部分的な成功を許容）
  return neverthrow.ok(parseResult.logInfos);
};

export type LogInfoPartialSuccessResult = PartialSuccessResult<
  (
    | VRChatWorldJoinLog
    | VRChatWorldLeaveLog
    | VRChatPlayerJoinLog
    | VRChatPlayerLeaveLog
  )[],
  { path: string; error: VRChatLogFileError }
>;

/**
 * 複数のVRChatログファイルからログ情報を取得（部分的な成功を許容）
 * エラーが発生しても処理を継続し、成功した部分のデータを返す
 * @param logFilePathList ログファイルパスのリスト
 * @returns 部分的な成功結果（成功したログ情報とエラー情報）
 */
export const getVRChaLogInfoByLogFilePathListWithPartialSuccess = (
  logFilePathList: (VRChatLogFilePath | VRChatLogStoreFilePath)[],
): ResultAsync<LogInfoPartialSuccessResult, never> => {
  return ResultAsync.fromSafePromise(
    (async (): Promise<LogInfoPartialSuccessResult> => {
      const logLineListResult =
        await getLogLinesByLogFilePathListWithPartialSuccess({
          logFilePathList,
          includesList: [
            'VRC Analytics Initialized', // TODO: 今後実装
            '[Behaviour] Joining ',
            '[Behaviour] OnPlayerJoined ',
            '[Behaviour] OnPlayerLeft ',
            'VRCApplication: HandleApplicationQuit', // worldLeaveParserで処理
          ],
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
    })(),
  );
};

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
