import { Effect } from 'effect';
import { z } from 'zod';
import { executeQuery } from '../../lib/dbHelper';
import { runEffect } from '../../lib/effectTRPC';
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
    .mutation(({ input }: { input: QueryInput }) => {
      return runEffect(
        executeQuery(input.query).pipe(
          Effect.mapError((error) =>
            UserFacingError.withStructuredInfo({
              code: ERROR_CODES.DATABASE_ERROR,
              category: ERROR_CATEGORIES.DATABASE_ERROR,
              message: 'SQL query execution failed',
              userMessage: `SQLクエリの実行に失敗しました: ${error.message}`,
              cause: new Error(error.message),
            }),
          ),
        ),
      );
    }),
  setLogLevel: procedure
    .input(
      z.object({
        level: z.union([z.literal('debug'), z.literal('info')]),
      }),
    )
    .mutation(({ input }) => {
      return runEffect(
        Effect.try({
          try: () => {
            logger.setTransportsLevel(input.level);
            logger.info(`Log level set to: ${input.level}`);
            return { success: true };
          },
          catch: (error) => {
            logger.error({
              message: 'Failed to set log level',
              stack: error instanceof Error ? error : new Error(String(error)),
            });
            return UserFacingError.withStructuredInfo({
              code: ERROR_CODES.UNKNOWN,
              category: ERROR_CATEGORIES.UNKNOWN_ERROR,
              message: 'Failed to set log level',
              userMessage: 'ログレベルの設定に失敗しました。',
              cause: error instanceof Error ? error : new Error(String(error)),
            });
          },
        }),
      );
    }),
  getLogLevel: procedure.query(() => {
    // 現在のファイルログレベルを返す (コンソールレベルも通常は同じはず)
    return logger.transports.file.level || 'info'; // level が false の場合 'info' を返す
  }),
});
