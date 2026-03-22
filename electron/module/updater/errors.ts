/**
 * アップデーターサービスの Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** アップデートチェックに失敗 */
export class UpdateCheckFailed extends Data.TaggedError('UpdateCheckFailed')<{
  message: string;
  cause: unknown;
}> {}
