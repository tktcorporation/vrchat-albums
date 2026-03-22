/**
 * ログ情報処理の Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** ログ情報のDBクエリに失敗 */
export class LogInfoDatabaseQueryFailed extends Data.TaggedError(
  'LogInfoDatabaseQueryFailed',
)<{
  message: string;
}> {}

/** ログファイルの読み込みに失敗 */
export class LogInfoFileReadFailed extends Data.TaggedError(
  'LogInfoFileReadFailed',
)<{
  message: string;
}> {}

/** ログ情報の不明なエラー */
export class LogInfoUnknownError extends Data.TaggedError(
  'LogInfoUnknownError',
)<{
  message: string;
}> {}

/** ログ情報エラーの Union 型 */
export type LogInfoServiceError =
  | LogInfoDatabaseQueryFailed
  | LogInfoFileReadFailed
  | LogInfoUnknownError;
