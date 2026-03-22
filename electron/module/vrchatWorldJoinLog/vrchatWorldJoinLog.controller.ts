import { z } from 'zod';

import { procedure, router as trpcRouter } from '../../trpc';
import { findVRChatWorldJoinLogFromPhotoList } from '../vrchatWorldJoinLogFromPhoto/service';
import {
  findVRChatWorldJoinLogList,
  mergeVRChatWorldJoinLogs,
} from './service';

/**
 * ワールド参加ログ関連のAPIルーター
 * フロントエンドからの tRPC 呼び出しに対応
 */
export const vrchatWorldJoinLogRouter = () =>
  trpcRouter({
    /**
     * 自身がVRChatのワールドに参加したログを取得します
     * @param gtJoinDateTime - 参加日時の下限
     * @param ltJoinDateTime - 参加日時の上限
     * @param orderByJoinDateTime - 参加日時のソート順
     * @returns 参加したユーザーのログ
     */
    getVRChatWorldJoinLogList: procedure
      .input(
        z.object({
          gtJoinDateTime: z.date().optional(),
          ltJoinDateTime: z.date().optional(),
          orderByJoinDateTime: z.enum(['asc', 'desc']),
        }),
      )
      .query(
        async ({
          input,
        }): Promise<
          {
            id: string;
            worldId: string;
            worldName: string;
            worldInstanceId: string;
            joinDateTime: Date;
            createdAt: Date;
            updatedAt: Date | null;
          }[]
        > => {
          const [normalLogs, photoLogs] = await Promise.all([
            findVRChatWorldJoinLogList({
              gtJoinDateTime: input.gtJoinDateTime,
              ltJoinDateTime: input.ltJoinDateTime,
              orderByJoinDateTime: input.orderByJoinDateTime,
            }),
            findVRChatWorldJoinLogFromPhotoList({
              gtJoinDateTime: input.gtJoinDateTime,
              ltJoinDateTime: input.ltJoinDateTime,
              orderByJoinDateTime: input.orderByJoinDateTime,
            }),
          ]);

          const mergedLogs = mergeVRChatWorldJoinLogs({
            normalLogs: normalLogs,
            photoLogs: photoLogs,
          });

          // 日時でソート
          return mergedLogs.sort((a, b) => {
            const comparison =
              a.joinDateTime.getTime() - b.joinDateTime.getTime();
            return input.orderByJoinDateTime === 'asc'
              ? comparison
              : -comparison;
          });
        },
      ),
  });
