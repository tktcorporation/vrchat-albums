/**
 * VRChat 写真メタデータ関連の Data.TaggedError 定義
 *
 * 背景: Effect TS ネイティブのエラーハンドリングのため、
 * 1 エラー = 1 クラス（Data.TaggedError）で定義する。
 * Effect.catchTag("MetadataDbError", ...) で型安全にハンドリング可能。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** DB アクセス時の予期しないエラー（Sentry 送信対象） */
export class MetadataDbError extends Data.TaggedError('MetadataDbError')<{
  message: string;
}> {}
