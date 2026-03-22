/**
 * VRChat ログファイル関連の Data.TaggedError 定義
 *
 * 背景: Effect TS ネイティブのエラーハンドリングのため、
 * 1 エラー = 1 クラス（Data.TaggedError）で定義する。
 * Effect.catchTag("LogFileNotFound", ...) で型安全にハンドリング可能。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** VRChat ログファイルが見つからない */
export class LogFileNotFound extends Data.TaggedError('LogFileNotFound')<{
  message: string;
}> {}

/** VRChat ログファイルディレクトリが見つからない */
export class LogFileDirNotFound extends Data.TaggedError('LogFileDirNotFound')<{
  message: string;
}> {}

/** VRChat ログファイルが1つも見つからない */
export class LogFilesNotFound extends Data.TaggedError('LogFilesNotFound')<{
  message: string;
}> {}

/** ログ保存ディレクトリの作成に失敗 */
export class LogStoreDirCreateFailed extends Data.TaggedError(
  'LogStoreDirCreateFailed',
)<{
  message: string;
}> {}

/** 月別ログディレクトリの作成に失敗 */
export class LogMonthDirCreateFailed extends Data.TaggedError(
  'LogMonthDirCreateFailed',
)<{
  message: string;
}> {}

/** ログファイルの書き込みに失敗 */
export class LogFileWriteFailed extends Data.TaggedError('LogFileWriteFailed')<{
  message: string;
}> {}

/** ログファイルのパースに失敗 */
export class LogParseError extends Data.TaggedError('LogParseError')<{
  message: string;
}> {}

/** 不明なVRChatログエラー */
export class VRChatLogUnknownError extends Data.TaggedError(
  'VRChatLogUnknownError',
)<{
  message: string;
}> {}

/** VRChatログエラーの Union 型 */
export type VRChatLogError =
  | LogFileNotFound
  | LogFileDirNotFound
  | LogFilesNotFound
  | LogStoreDirCreateFailed
  | LogMonthDirCreateFailed
  | LogFileWriteFailed
  | LogParseError
  | VRChatLogUnknownError;
