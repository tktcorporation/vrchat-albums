import z from 'zod';
import { handleVRChatLogError } from '../../lib/errorHelpers';
import { procedure, router as trpcRouter } from '../../trpc';
import { LOG_SYNC_MODE, type LogSyncMode, syncLogs } from './service';

const logSyncModeSchema = z.enum([
  LOG_SYNC_MODE.FULL,
  LOG_SYNC_MODE.INCREMENTAL,
]);

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
        const result = await syncLogs(input.mode as LogSyncMode);

        // VRChatLogFileErrorを適切なUserFacingErrorに変換
        handleVRChatLogError(result);

        return true;
      }),
  });
};
