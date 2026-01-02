/**
 * Branded Type 定義モジュール
 *
 * メソッドを持たない単純な値の型安全性を確保するために、
 * Zod の brand() を使用した Branded Type を定義します。
 *
 * @example
 * ```typescript
 * // スキーマ経由でのみ値を作成可能
 * const worldId = VRChatWorldIdSchema.parse('wrld_xxx...');
 *
 * // 型は VRChatWorldId（string & { __brand: 'VRChatWorldId' }）
 * type WorldIdType = typeof worldId; // VRChatWorldId
 *
 * // 生の文字列は代入不可
 * const invalid: VRChatWorldId = 'wrld_xxx...'; // ❌ Type error
 * ```
 */

import { z } from 'zod';
import {
  isValidVRChatPlayerId,
  isValidVRChatPlayerName,
  isValidVRChatWorldId,
  isValidVRChatWorldName,
} from './vrchatIdValidation.js';

// ============================================================================
// VRChat World ID
// ============================================================================

/**
 * VRChat World ID スキーマ
 * 形式: wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export const VRChatWorldIdSchema = z
  .string()
  .refine(isValidVRChatWorldId, {
    message:
      'Invalid VRChat World ID format. Expected: wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  })
  .brand<'VRChatWorldId'>();

export type VRChatWorldId = z.infer<typeof VRChatWorldIdSchema>;

// ============================================================================
// VRChat Player ID
// ============================================================================

/**
 * VRChat Player ID スキーマ
 * 形式: usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export const VRChatPlayerIdSchema = z
  .string()
  .refine(isValidVRChatPlayerId, {
    message:
      'Invalid VRChat Player ID format. Expected: usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  })
  .brand<'VRChatPlayerId'>();

export type VRChatPlayerId = z.infer<typeof VRChatPlayerIdSchema>;

/**
 * オプショナルな VRChat Player ID スキーマ
 */
export const OptionalVRChatPlayerIdSchema = z
  .string()
  .nullable()
  .transform((value) => {
    if (!value) return null;
    return VRChatPlayerIdSchema.parse(value);
  });

// ============================================================================
// VRChat Player Name
// ============================================================================

/**
 * VRChat Player Name スキーマ
 * 空文字列ではない文字列
 */
export const VRChatPlayerNameSchema = z
  .string()
  .refine(isValidVRChatPlayerName, {
    message: 'Invalid VRChat Player Name. Cannot be empty',
  })
  .brand<'VRChatPlayerName'>();

export type VRChatPlayerName = z.infer<typeof VRChatPlayerNameSchema>;

// ============================================================================
// VRChat World Name
// ============================================================================

/**
 * VRChat World Name スキーマ
 * 空文字列ではない文字列
 */
export const VRChatWorldNameSchema = z
  .string()
  .refine(isValidVRChatWorldName, {
    message: 'Invalid VRChat World Name. Cannot be empty',
  })
  .brand<'VRChatWorldName'>();

export type VRChatWorldName = z.infer<typeof VRChatWorldNameSchema>;

// ============================================================================
// VRChat Log Line
// ============================================================================

/**
 * VRChat Log Line スキーマ
 * ログファイルの1行を表す
 */
export const VRChatLogLineSchema = z.string().brand<'VRChatLogLine'>();

export type VRChatLogLine = z.infer<typeof VRChatLogLineSchema>;

// ============================================================================
// Folder Digest (ハッシュ値)
// ============================================================================

/**
 * ハッシュ形式の正規表現（32文字の小文字16進数）
 * hash-wasm の xxhash128 と互換
 */
export const MD5_HASH_REGEX = /^[a-f0-9]{32}$/;

/**
 * フォルダ内容のダイジェスト（xxhash128ハッシュ）
 * hash-wasm ライブラリが生成するハッシュ値
 */
export const FolderDigestSchema = z
  .string()
  .regex(MD5_HASH_REGEX, 'Invalid MD5 hash format')
  .brand<'FolderDigest'>();

export type FolderDigest = z.infer<typeof FolderDigestSchema>;

// ============================================================================
// VRChat Photo Containing Folder Path
// ============================================================================

/**
 * VRChat写真を含むフォルダのパス
 *
 * スキャンによって発見された、VRChat_*.png を含むフォルダを表す。
 * この型は `getPhotoFolders` 関数の出力としてのみ生成されるべき。
 *
 * @remarks
 * - VRChat写真が存在することの検証は型レベルではなく `getPhotoFolders` で実行
 * - 任意のパス文字列からの生成は避け、スキャン結果としてのみ使用すること
 * - VRChatPhotoDirPath（ユーザー設定のベースディレクトリ）とは区別される
 */
export const VRChatPhotoContainingFolderPathSchema = z
  .string()
  .min(1, 'Folder path cannot be empty')
  .brand<'VRChatPhotoContainingFolderPath'>();

export type VRChatPhotoContainingFolderPath = z.infer<
  typeof VRChatPhotoContainingFolderPathSchema
>;
