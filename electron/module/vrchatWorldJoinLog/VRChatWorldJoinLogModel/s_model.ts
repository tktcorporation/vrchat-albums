import { and, asc, countDistinct, desc, gt, lt } from 'drizzle-orm';

import { insertInChunks } from '../../../lib/db/chunkedInsert';
import { type DBExecutor, getDB } from '../../../lib/db/client';
import { vrchatWorldJoinLogs } from '../../../lib/db/schema';
import type { VRChatWorldJoinLog } from '../../vrchatLog/service';

/**
 * VRChat のログから読んだワールド入室の行。
 *
 * @see docs/log-sync-architecture.md - ログ同期の設計
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see VRChatWorldJoinLogFromPhotoModel - 写真由来ログ
 */
export type VRChatWorldJoinLogModel = typeof vrchatWorldJoinLogs.$inferSelect;

/**
 * ワールド参加ログを一括登録し、新しく登録した行を返す。
 *
 * 同じインスタンスへの同じ時刻の参加（一意インデックス worldInstanceId-joinDateTime）は挿入しない。
 * 衝突先を指定しない ON CONFLICT DO NOTHING にしているのは、古い DB に残る別の一意インデックスに
 * 当たった行も、エラーにせず挿入しないため。
 * 同期で実行するので、ログの一括登録のトランザクションの中からそのトランザクションを渡して呼べる。
 */
export const insertVRChatWorldJoinLogs = (
  executor: DBExecutor,
  vrchatWorldJoinLogList: VRChatWorldJoinLog[],
): VRChatWorldJoinLogModel[] => {
  return insertInChunks(
    executor,
    vrchatWorldJoinLogs,
    vrchatWorldJoinLogList.map((logInfo) => ({
      joinDateTime: logInfo.joinDate,
      worldId: logInfo.worldId,
      // VRChatWorldInstanceId はメソッドを持つクラスなので文字列を取り出す
      worldInstanceId: logInfo.worldInstanceId.value,
      worldName: logInfo.worldName,
    })),
    (tx, rows) =>
      tx
        .insert(vrchatWorldJoinLogs)
        .values(rows)
        .onConflictDoNothing()
        .returning()
        .all(),
  );
};

/** 既定の DB に `insertVRChatWorldJoinLogs` を実行する。service 層から呼び出される */
export const createVRChatWorldJoinLog = async (
  vrchatWorldJoinLogList: VRChatWorldJoinLog[],
): Promise<VRChatWorldJoinLogModel[]> =>
  insertVRChatWorldJoinLogs(getDB(), vrchatWorldJoinLogList);

/** すべてのワールド参加ログを返す */
export const findAllVRChatWorldJoinLogList = async (): Promise<
  VRChatWorldJoinLogModel[]
> =>
  getDB()
    .select()
    .from(vrchatWorldJoinLogs)
    .orderBy(desc(vrchatWorldJoinLogs.joinDateTime))
    .all();

/**
 * VRChatでのWorldJoin記録を取得する
 */
export const findVRChatWorldJoinLogList = async (query?: {
  gtJoinDateTime?: Date;
  ltJoinDateTime?: Date;
  orderByJoinDateTime: 'asc' | 'desc';
  /** 取得する最大件数。orderByJoinDateTime の順で先頭から数える。省略時は全件 */
  limit?: number;
}): Promise<VRChatWorldJoinLogModel[]> => {
  const column = vrchatWorldJoinLogs.joinDateTime;
  const select = getDB()
    .select()
    .from(vrchatWorldJoinLogs)
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

/** 最新のワールド参加ログを取得する */
export const findLatestWorldJoinLog =
  async (): Promise<VRChatWorldJoinLogModel | null> =>
    getDB()
      .select()
      .from(vrchatWorldJoinLogs)
      .orderBy(desc(vrchatWorldJoinLogs.joinDateTime))
      .limit(1)
      .get() ?? null;

/**
 * 訪れたワールドの数（ワールド ID の重複を除く）を数える。
 * 起動画面の統計（initProgress/stats.ts）から呼び出される。
 */
export const countDistinctVisitedWorlds = async (): Promise<number> =>
  getDB()
    .select({ count: countDistinct(vrchatWorldJoinLogs.worldId) })
    .from(vrchatWorldJoinLogs)
    .get()?.count ?? 0;
