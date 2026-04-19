import { Effect } from 'effect';
import z from 'zod';

import { runEffect } from '../../lib/effectTRPC';
import {
  mapByTag,
  mapToUnknownError,
  toUserFacing,
} from '../../lib/errorMapping';
import { ERROR_CATEGORIES, ERROR_CODES } from '../../lib/errors';
import { procedure, router as trpcRouter } from '../../trpc';
import { LOG_SYNC_MODE, type LogSyncMode, syncLogs } from './service';

const logSyncModeSchema = z.enum([
  LOG_SYNC_MODE.FULL,
  LOG_SYNC_MODE.INCREMENTAL,
]);

/**
 * ログ同期エラーを UserFacingError に変換するヘルパー。
 *
 * VRChatLogFileError, VRChatLogError, LogInfoError, LogInfoServiceError を
 * `_tag` で分岐し、未知の tag は「ログ同期中にエラー」として扱う。
 */
const mapSyncErrorToUserFacing = mapByTag<{ _tag?: string; message: string }>(
  {
    LogFileDirNotFound: toUserFacing({
      code: ERROR_CODES.VRCHAT_DIRECTORY_SETUP_REQUIRED,
      category: ERROR_CATEGORIES.SETUP_REQUIRED,
      userMessage:
        'VRChatのログディレクトリが見つかりません。VRChatがインストールされているか確認してください。',
    }),
    LogFilesNotFound: toUserFacing({
      code: ERROR_CODES.FILE_NOT_FOUND,
      category: ERROR_CATEGORIES.FILE_NOT_FOUND,
      userMessage:
        'VRChatのログファイルが見つかりません。VRChatを一度起動してから再度お試しください。',
    }),
  },
  mapToUnknownError('ログ同期中にエラーが発生しました。'),
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
