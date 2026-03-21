import { Effect } from 'effect';
import { match } from 'ts-pattern';
import z from 'zod';
import { runEffect } from '../../lib/effectTRPC';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { procedure, router as trpcRouter } from '../../trpc';
import { LOG_SYNC_MODE, type LogSyncMode, syncLogs } from './service';

const logSyncModeSchema = z.enum([
  LOG_SYNC_MODE.FULL,
  LOG_SYNC_MODE.INCREMENTAL,
]);

/**
 * ログ同期エラーを UserFacingError に変換するヘルパー
 * VRChatLogFileError, VRChatLogError, LogInfoError, LogInfoServiceError を統一的に処理
 */
const mapSyncErrorToUserFacing = (e: { message: string; _tag?: string }) =>
  match(e._tag)
    .with('LogFileDirNotFound', () =>
      UserFacingError.withStructuredInfo({
        code: ERROR_CODES.VRCHAT_DIRECTORY_SETUP_REQUIRED,
        category: ERROR_CATEGORIES.SETUP_REQUIRED,
        message: e.message,
        userMessage:
          'VRChatのログディレクトリが見つかりません。VRChatがインストールされているか確認してください。',
        cause: e instanceof Error ? e : new Error(e.message),
      }),
    )
    .with('LogFilesNotFound', () =>
      UserFacingError.withStructuredInfo({
        code: ERROR_CODES.FILE_NOT_FOUND,
        category: ERROR_CATEGORIES.FILE_NOT_FOUND,
        message: e.message,
        userMessage:
          'VRChatのログファイルが見つかりません。VRChatを一度起動してから再度お試しください。',
        cause: e instanceof Error ? e : new Error(e.message),
      }),
    )
    .otherwise(() =>
      UserFacingError.withStructuredInfo({
        code: ERROR_CODES.UNKNOWN,
        category: ERROR_CATEGORIES.UNKNOWN_ERROR,
        message: e.message,
        userMessage: 'ログ同期中にエラーが発生しました。',
        cause: e instanceof Error ? e : new Error(e.message),
      }),
    );

/**
 * ログ同期のためのtRPCルーター
 */
export const logSyncRouter = () => {
  return trpcRouter({
    /**
     * ログの同期を実行する
     *
     * @param mode 同期モード (FULL: 全件処理, INCREMENTAL: 差分処理)
     */
    syncLogs: procedure
      .input(
        z.object({
          mode: logSyncModeSchema,
        }),
      )
      .mutation(async ({ input }) => {
        await runEffect(
          syncLogs(input.mode as LogSyncMode).pipe(
            Effect.mapError(mapSyncErrorToUserFacing),
          ),
        );

        return true;
      }),
  });
};
