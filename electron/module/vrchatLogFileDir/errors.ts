/**
 * VRChat ログファイルディレクトリの Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** ログファイルが見つからない */
export class LogFileDirLogFilesNotFound extends Data.TaggedError(
  'LogFileDirLogFilesNotFound',
)<{
  message: string;
}> {}

/** ログファイルディレクトリが見つからない */
export class LogFileDirNotFoundError extends Data.TaggedError(
  'LogFileDirNotFoundError',
)<{
  message: string;
}> {}

/** VRChat ログファイルディレクトリエラーの Union 型 */
export type VRChatLogFileDirServiceError =
  | LogFileDirLogFilesNotFound
  | LogFileDirNotFoundError;
