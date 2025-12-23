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
  isValidVRChatWorldId,
  isValidVRChatPlayerId,
  isValidVRChatWorldInstanceId,
  isValidVRChatPlayerName,
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
// VRChat World Instance ID
// ============================================================================

/**
 * VRChat World Instance ID スキーマ
 * 形式: 英数字のみ、または英数字~region(region_code)形式
 *
 * 注: このIDはメソッド（getInstanceType等）を持つため、
 * BaseValueObject を継承したクラスとして定義する必要があります。
 * ここでは基本的な検証スキーマのみを提供します。
 */
export const VRChatWorldInstanceIdBaseSchema = z
  .string()
  .refine(isValidVRChatWorldInstanceId, {
    message:
      'Invalid VRChat World Instance ID format. Expected: alphanumeric string or alphanumeric~region(region_code)',
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
// Path Types (メソッドなしのシンプルなパス)
// ============================================================================

/**
 * VRChat Photo Directory Path スキーマ
 */
export const VRChatPhotoDirPathSchema = z
  .string()
  .min(1, 'Photo directory path cannot be empty')
  .brand<'VRChatPhotoDirPath'>();

export type VRChatPhotoDirPath = z.infer<typeof VRChatPhotoDirPathSchema>;

/**
 * VRChat Log Files Directory Path スキーマ
 */
export const VRChatLogFilesDirPathSchema = z
  .string()
  .min(1, 'Log files directory path cannot be empty')
  .brand<'VRChatLogFilesDirPath'>();

export type VRChatLogFilesDirPath = z.infer<typeof VRChatLogFilesDirPathSchema>;

/**
 * 未検証の VRChat Log Files Directory Path スキーマ
 * ユーザー入力などで、まだ存在確認されていないパス
 */
export const NotValidatedVRChatLogFilesDirPathSchema = z
  .string()
  .min(1, 'Log files directory path cannot be empty')
  .brand<'NotValidatedVRChatLogFilesDirPath'>();

export type NotValidatedVRChatLogFilesDirPath = z.infer<
  typeof NotValidatedVRChatLogFilesDirPathSchema
>;

/**
 * VRChat Log File Path スキーマ
 * output_log_*.txt 形式のログファイルパス
 */
export const VRChatLogFilePathSchema = z
  .string()
  .refine((value) => value.includes('output_log') && value.endsWith('.txt'), {
    message: 'Invalid VRChat log file path. Expected: output_log_*.txt',
  })
  .brand<'VRChatLogFilePath'>();

export type VRChatLogFilePath = z.infer<typeof VRChatLogFilePathSchema>;
