/**
 * 設定・アップデート関連のエラー定義（Data.TaggedError）
 *
 * 背景: settings サービスでのアップデートチェック時のエラーを
 * 1 エラー = 1 クラスで定義する。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** アップデートチェックに失敗 */
export class UpdateCheckFailed extends Data.TaggedError('UpdateCheckFailed')<{
  message: string;
}> {}
