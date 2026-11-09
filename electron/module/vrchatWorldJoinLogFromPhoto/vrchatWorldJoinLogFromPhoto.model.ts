import { and, asc, desc, gt, lt } from 'drizzle-orm';

import { insertInChunks } from '../../lib/db/chunkedInsert';
import { getDB } from '../../lib/db/client';
import { vrchatWorldJoinLogsFromPhoto } from '../../lib/db/schema';
import type { WorldId } from '../vrchatLog/type';

export interface VRChatWorldJoinLogFromPhoto {
  joinDate: Date;
  worldId: WorldId;
}

/**
 * 写真から推定したワールド入室の行。
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see VRChatWorldJoinLogModel - ログ由来のワールド入室情報
 */
export type VRChatWorldJoinLogFromPhotoModel =
  typeof vrchatWorldJoinLogsFromPhoto.$inferSelect;

/**
 * 写真から抽出したワールド入室情報を保存し、新しく登録した行を返す。
 * 同じワールドの同じ時刻（一意インデックス worldInstanceId-joinDateTime-fromPhoto）は挿入しない。
 * 衝突先を指定しない ON CONFLICT DO NOTHING にしているのは、古い DB に残る別の一意インデックスに
 * 当たった行も、エラーにせず挿入しないため。
 */
export const createVRChatWorldJoinLogFromPhoto = async (
  vrchatWorldJoinLogFromPhotoList: VRChatWorldJoinLogFromPhoto[],
): Promise<VRChatWorldJoinLogFromPhotoModel[]> => {
  return insertInChunks(
    getDB(),
    vrchatWorldJoinLogsFromPhoto,
    vrchatWorldJoinLogFromPhotoList.map((logInfo) => ({
      joinDateTime: logInfo.joinDate,
      worldId: logInfo.worldId,
    })),
    (executor, rows) =>
      executor
        .insert(vrchatWorldJoinLogsFromPhoto)
        .values(rows)
        .onConflictDoNothing()
        .returning()
        .all(),
  );
};

/**
 * 保存済みの写真由来ワールド入室ログを取得するモデル関数。
 * controller 層やテストから利用される。
 */
export const findVRChatWorldJoinLogFromPhotoList = async (query?: {
  gtJoinDateTime?: Date;
  ltJoinDateTime?: Date;
  orderByJoinDateTime: 'asc' | 'desc';
  /** 取得する最大件数。orderByJoinDateTime の順で先頭から数える。省略時は全件 */
  limit?: number;
}): Promise<VRChatWorldJoinLogFromPhotoModel[]> => {
  const column = vrchatWorldJoinLogsFromPhoto.joinDateTime;
  const select = getDB()
    .select()
    .from(vrchatWorldJoinLogsFromPhoto)
    .where(
      and(
        query?.gtJoinDateTime ? gt(column, query.gtJoinDateTime) : undefined,
        query?.ltJoinDateTime ? lt(column, query.ltJoinDateTime) : undefined,
      ),
    )
    .orderBy(query?.orderByJoinDateTime === 'desc' ? desc(column) : asc(column))
    .$dynamic();
  return (
    query?.limit === undefined ? select : select.limit(query.limit)
  ).all();
};
