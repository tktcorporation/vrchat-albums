/**
 * VRChat API サービスの Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** ワールドが見つからない（404） */
export class VRChatApiWorldNotFound extends Data.TaggedError(
  'VRChatApiWorldNotFound',
)<{
  worldId: string;
}> {}

/** API リクエストに失敗 */
export class VRChatApiRequestFailed extends Data.TaggedError(
  'VRChatApiRequestFailed',
)<{
  message: string;
}> {}

/** API レスポンスのパースに失敗 */
export class VRChatApiParseError extends Data.TaggedError(
  'VRChatApiParseError',
)<{
  issues: string;
}> {}

/** VRChat API エラーの Union 型 */
export type VRChatApiServiceError =
  | VRChatApiWorldNotFound
  | VRChatApiRequestFailed
  | VRChatApiParseError;
