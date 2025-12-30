import { Result } from 'neverthrow';
import { z } from 'zod';
import { executeQuery } from '../../lib/dbHelper';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { logger } from '../../lib/logger';
import { procedure, router } from '../../trpc';

type QueryInput = {
  query: string;
};

export const debugRouter = router({
  executeSqlite: procedure
    .input(
      z.object({
        query: z.string(),
      }),
    )
    .mutation(async ({ input }: { input: QueryInput }) => {
      try {
        // DBQueueを使用してクエリを実行
        const result = await executeQuery(input.query);
        if (result.isErr()) {
          throw UserFacingError.withStructuredInfo({
            code: ERROR_CODES.DATABASE_ERROR,
            category: ERROR_CATEGORIES.DATABASE_ERROR,
            message: 'SQL query execution failed',
            userMessage: `SQLクエリの実行に失敗しました: ${result.error.message}`,
            cause:
              result.error instanceof Error
                ? result.error
                : new Error(String(result.error)),
          });
        }
        return result.value;
      } catch (error: unknown) {
        if (error instanceof Error) {
          throw UserFacingError.withStructuredInfo({
            code: ERROR_CODES.DATABASE_ERROR,
            category: ERROR_CATEGORIES.DATABASE_ERROR,
            message: 'SQL query execution failed',
            userMessage: `SQLクエリの実行に失敗しました: ${error.message}`,
            cause: error,
          });
        }
        throw UserFacingError.withStructuredInfo({
          code: ERROR_CODES.UNKNOWN,
          category: ERROR_CATEGORIES.UNKNOWN_ERROR,
          message: 'Unexpected error during SQL query execution',
          userMessage: 'SQLクエリの実行中に予期しないエラーが発生しました。',
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),
  setLogLevel: procedure
    .input(
      z.object({
        level: z.union([z.literal('debug'), z.literal('info')]),
      }),
    )
    .mutation(async ({ input }) => {
      const result = Result.fromThrowable(
        () => {
          logger.setTransportsLevel(input.level);
          logger.info(`Log level set to: ${input.level}`);
          return { success: true };
        },
        (error) => error,
      )();

      if (result.isErr()) {
        const error = result.error;
        logger.error({
          message: 'Failed to set log level',
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        throw UserFacingError.withStructuredInfo({
          code: ERROR_CODES.UNKNOWN,
          category: ERROR_CATEGORIES.UNKNOWN_ERROR,
          message: 'Failed to set log level',
          userMessage: 'ログレベルの設定に失敗しました。',
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }

      return result.value;
    }),
  getLogLevel: procedure.query(() => {
    // 現在のファイルログレベルを返す (コンソールレベルも通常は同じはず)
    return logger.transports.file.level || 'info'; // level が false の場合 'info' を返す
  }),
});
