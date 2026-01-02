/**
 * フロントエンド用エラー型定義
 * electron/lib/errors.ts の型定義と同期する必要がある
 */

import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  type ErrorCategory,
  type ErrorCode,
} from './errorConstants';
import { extractStructuredError } from './errorSchemas';

// Re-export for backward compatibility
export { ERROR_CATEGORIES, ERROR_CODES, type ErrorCategory, type ErrorCode };

/**
 * tRPCエラーからエラー情報を抽出
 */
export interface ParsedErrorInfo {
  code: ErrorCode;
  category: ErrorCategory;
  userMessage: string;
  isSetupRequired: boolean;
  isPermissionDenied: boolean;
  isUnknown: boolean;
}

/**
 * tRPCエラーオブジェクトから構造化情報を解析（優先）
 * ランタイムで型チェックを行うため、unknownで受け取る
 */
export function parseErrorFromTRPC(error: unknown): ParsedErrorInfo {
  // Zodベースの安全な方法で構造化エラー情報を取得
  const structuredError = extractStructuredError(error);

  if (structuredError) {
    return {
      code: structuredError.code,
      category: structuredError.category,
      userMessage: structuredError.userMessage,
      isSetupRequired:
        structuredError.category === ERROR_CATEGORIES.SETUP_REQUIRED,
      isPermissionDenied:
        structuredError.category === ERROR_CATEGORIES.PERMISSION_DENIED,
      isUnknown: structuredError.category === ERROR_CATEGORIES.UNKNOWN_ERROR,
    };
  }

  // 構造化情報がない場合はエラーメッセージから推測
  const errorMessage =
    error instanceof Error ? error.message : '予期しないエラーが発生しました。';

  return {
    code: ERROR_CODES.UNKNOWN,
    category: ERROR_CATEGORIES.UNKNOWN_ERROR,
    userMessage: errorMessage,
    isSetupRequired: false,
    isPermissionDenied: false,
    isUnknown: true,
  };
}
