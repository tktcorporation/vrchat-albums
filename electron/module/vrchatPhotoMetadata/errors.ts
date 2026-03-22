/**
 * VRChat 写真メタデータ関連の Data.TaggedError 定義
 *
 * 背景: Effect TS ネイティブのエラーハンドリングのため、
 * 1 エラー = 1 クラス（Data.TaggedError）で定義する。
 * Effect.catchTag("NoMetadataFound", ...) で型安全にハンドリング可能。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** DB アクセス時の予期しないエラー（Sentry 送信対象） */
export class MetadataDbError extends Data.TaggedError('MetadataDbError')<{
  message: string;
}> {}

/** 写真ファイルに XMP メタデータが存在しない（正常系、silent） */
export class NoMetadataFound extends Data.TaggedError('NoMetadataFound')<{
  photoPath: string;
}> {}

/** XMP メタデータのパースに失敗した（正常系、silent） */
export class MetadataParseError extends Data.TaggedError('MetadataParseError')<{
  photoPath: string;
  message: string;
}> {}
