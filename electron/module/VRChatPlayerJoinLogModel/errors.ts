/**
 * プレイヤー参加ログの Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** プレイヤー参加ログのDBエラー */
export class PlayerJoinLogDatabaseError extends Data.TaggedError(
  'PlayerJoinLogDatabaseError',
)<{
  message: string;
}> {}

/** プレイヤー参加ログが見つからない */
export class PlayerJoinLogNotFound extends Data.TaggedError(
  'PlayerJoinLogNotFound',
)<{
  message: string;
}> {}

/** プレイヤー参加ログの日付範囲が不正 */
export class PlayerJoinLogInvalidDateRange extends Data.TaggedError(
  'PlayerJoinLogInvalidDateRange',
)<{
  message: string;
}> {}

/** プレイヤー参加ログエラーの Union 型 */
export type PlayerJoinLogServiceError =
  | PlayerJoinLogDatabaseError
  | PlayerJoinLogNotFound
  | PlayerJoinLogInvalidDateRange;
