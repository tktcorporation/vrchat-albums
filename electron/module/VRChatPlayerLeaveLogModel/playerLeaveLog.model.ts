import { insertInChunks } from '../../lib/db/chunkedInsert';
import { type DBExecutor, getDB } from '../../lib/db/client';
import { vrchatPlayerLeaveLogs } from '../../lib/db/schema';

/**
 * プレイヤー退出ログの行。
 *
 * @see docs/log-sync-architecture.md - ログ同期の設計
 * @see docs/photo-grouping-logic.md - セッション単位の写真グループ化
 */
export type VRChatPlayerLeaveLogModel =
  typeof vrchatPlayerLeaveLogs.$inferSelect;

/**
 * プレイヤー退出ログを一括登録し、新しく登録した行を返す。
 *
 * 同期で実行するので、ログの一括登録のトランザクション（`logInfo/service.ts`）の中から
 * そのトランザクションを渡して呼べる。主キー以外に一意制約が無いため、重複の除去はしない。
 * 一意制約に当たった行は、どの制約かを問わず挿入しない（ON CONFLICT DO NOTHING）。
 */
export const insertVRChatPlayerLeaveLogs = (
  executor: DBExecutor,
  leaveLogList: {
    leaveDateTime: Date;
    playerName: string;
    playerId: string | null;
  }[],
): VRChatPlayerLeaveLogModel[] => {
  return insertInChunks(
    executor,
    vrchatPlayerLeaveLogs,
    leaveLogList,
    (tx, rows) =>
      tx
        .insert(vrchatPlayerLeaveLogs)
        .values(rows)
        .onConflictDoNothing()
        .returning()
        .all(),
  );
};

/** 既定の DB に `insertVRChatPlayerLeaveLogs` を実行する */
export const createVRChatPlayerLeaveLogs = async (
  leaveLogList: Parameters<typeof insertVRChatPlayerLeaveLogs>[1],
): Promise<VRChatPlayerLeaveLogModel[]> =>
  insertVRChatPlayerLeaveLogs(getDB(), leaveLogList);
