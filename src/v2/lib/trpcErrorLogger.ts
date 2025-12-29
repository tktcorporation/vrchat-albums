/**
 * tRPCエラーのログ出力ユーティリティ
 *
 * エラー分類:
 * - TRPCClientError: warn（サーバー応答あり、リトライ可能）
 * - その他: error（ネットワーク障害など、Sentryに送信）
 */
import { TRPCClientError } from '@trpc/client';
import { match, P } from 'ts-pattern';
import { logger } from './logger';

interface TRPCErrorLogContext {
  /** 操作名（例: 'fetch batch thumbnails'） */
  operation: string;
  /** バッチサイズ（任意） */
  batchSize?: number;
  /** 追加のdetails */
  additionalDetails?: Record<string, unknown>;
}

/**
 * tRPCフェッチエラーをログ出力
 *
 * @example
 * ```typescript
 * try {
 *   await utils.photo.getBatchThumbnails.fetch({ paths });
 * } catch (error) {
 *   logTRPCFetchError(error, {
 *     operation: 'fetch batch thumbnails',
 *     batchSize: paths.length,
 *   });
 *   throw error;
 * }
 * ```
 */
export function logTRPCFetchError(
  error: unknown,
  context: TRPCErrorLogContext,
): void {
  const details = {
    ...(context.batchSize !== undefined && { batchSize: context.batchSize }),
    ...context.additionalDetails,
  };

  match(error)
    .with(P.instanceOf(TRPCClientError), (trpcError) => {
      // tRPCエラー（サーバー応答あり）
      logger.warn({
        message: `tRPC error ${context.operation}`,
        error: trpcError,
        details: {
          ...details,
          code: trpcError.data?.code,
        },
      });
    })
    .otherwise((e) => {
      // ネットワークエラーなど予期しないエラー
      logger.error({
        message: `Failed to ${context.operation}`,
        error: e,
        details,
      });
    });
}
