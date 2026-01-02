/**
 * TRPC エラーの型定義
 * TRPCClientError を拡張してカスタムエラー情報を含める
 */

import type { TRPCClientError } from '@trpc/client';
import type { AppRouter } from '../../../electron/api';
import type { ErrorCategory, ErrorCode } from './errorConstants';

/**
 * 構造化エラー情報の型
 * バックエンドのerrorFormatterで設定される
 */
export interface StructuredError {
  code: ErrorCode;
  category: ErrorCategory;
  userMessage: string;
}

/**
 * カスタムエラーデータの型
 * TRPCのerrorFormatterで data に追加される情報
 */
export interface CustomErrorData {
  structuredError?: StructuredError;
  originalError?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * 型付きTRPCエラー
 * TRPCClientErrorにカスタムエラーデータを含めた型
 */
export type TypedTRPCError = TRPCClientError<AppRouter> & {
  data?: CustomErrorData;
};
