import * as dateFns from 'date-fns';
import {
  and,
  asc,
  countDistinct,
  desc,
  gte,
  lt,
  or,
  type SQL,
} from 'drizzle-orm';

import { type DBExecutor, getDB } from '../../lib/db/client';
import { vrchatPlayerJoinLogs } from '../../lib/db/schema';
import type { VRChatPlayerJoinLog } from '../vrchatLog/service';

/**
 * プレイヤー参加ログの行。
 *
 * @see docs/log-sync-architecture.md - ログ同期の設計
 * @see docs/photo-grouping-logic.md - セッション単位の写真グループ化
 * @see VRChatPlayerLeaveLogModel - 退出ログ
 */
export type VRChatPlayerJoinLogModel = typeof vrchatPlayerJoinLogs.$inferSelect;

/**
 * プレイヤー参加ログを一括登録し、新しく登録した行を返す。
 *
 * バッチ内の重複は playerName+joinDateTime キーで JS 側で除き、DB に既にある行との重複は
 * 一意インデックス（playerName-joinDateTime）に当たった行を挿入しないことで除く。
 * 同期で実行するので、ログの一括登録のトランザクションの中からそのトランザクションを渡して呼べる。
 */
export const insertVRChatPlayerJoinLogs = (
  executor: DBExecutor,
  playerJoinLogList: VRChatPlayerJoinLog[],
): VRChatPlayerJoinLogModel[] => {
  const seen = new Set<string>();
  const newLogs = playerJoinLogList
    .filter((logInfo) => {
      const key = `${logInfo.joinDate.toISOString()}|${logInfo.playerName}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((logInfo) => ({
      joinDateTime: logInfo.joinDate,
      playerId: logInfo.playerId ?? null,
      playerName: logInfo.playerName,
    }));

  if (newLogs.length === 0) {
    return [];
  }

  return executor
    .insert(vrchatPlayerJoinLogs)
    .values(newLogs)
    .onConflictDoNothing({
      target: [
        vrchatPlayerJoinLogs.playerName,
        vrchatPlayerJoinLogs.joinDateTime,
      ],
    })
    .returning()
    .all();
};

/** 既定の DB に `insertVRChatPlayerJoinLogs` を実行する */
export const createVRChatPlayerJoinLog = async (
  playerJoinLogList: VRChatPlayerJoinLog[],
): Promise<VRChatPlayerJoinLogModel[]> =>
  insertVRChatPlayerJoinLogs(getDB(), playerJoinLogList);

/** `[start, end)` の範囲の条件。end が null なら start 以降すべて */
const joinDateTimeInRange = (start: Date, end: Date | null): SQL | undefined =>
  and(
    gte(vrchatPlayerJoinLogs.joinDateTime, start),
    end === null ? undefined : lt(vrchatPlayerJoinLogs.joinDateTime, end),
  );

/**
 * joinDateTime を２つ取得して、その間にある playerJoinLog を取得する
 * endJoinDateTime がない場合は以降のデータを最大n日分取得する
 */
export const getVRChatPlayerJoinLogListByJoinDateTime = async (
  props:
    | {
        gteJoinDateTime: Date;
        ltJoinDateTime: Date;
        getUntilDays: null;
      }
    | {
        gteJoinDateTime: Date;
        ltJoinDateTime: null;
        // endJoinDateTime がない場合は以降のデータを最大n日分取得する
        getUntilDays: number;
      }
    | {
        gteJoinDateTime: Date;
        ltJoinDateTime: null;
        // getUntilDaysもnullの場合は無制限に取得する
        getUntilDays: null;
      },
): Promise<VRChatPlayerJoinLogModel[]> => {
  const end =
    props.ltJoinDateTime ??
    (props.getUntilDays === null
      ? null
      : dateFns.addDays(props.gteJoinDateTime, props.getUntilDays));
  return getDB()
    .select()
    .from(vrchatPlayerJoinLogs)
    .where(joinDateTimeInRange(props.gteJoinDateTime, end))
    .all();
};

/**
 * 複数の日時範囲のプレイヤー参加ログを一度のクエリで取得する
 * @param dateRanges 日時範囲の配列 { start: Date, end: Date, key: string }
 * @returns 各日時範囲のキーが含まれたプレイヤー参加ログの配列
 */
export const getVRChatPlayerJoinLogListByMultipleDateRanges = async (
  dateRanges: { start: Date; end: Date | null; key: string }[],
): Promise<(VRChatPlayerJoinLogModel & { range_key: string })[]> => {
  if (dateRanges.length === 0) {
    return [];
  }

  const playerJoinLogList = getDB()
    .select()
    .from(vrchatPlayerJoinLogs)
    .where(
      or(
        ...dateRanges.map(({ start, end }) => joinDateTimeInRange(start, end)),
      ),
    )
    .orderBy(asc(vrchatPlayerJoinLogs.joinDateTime))
    .all();

  // 各レコードにどの範囲に属するかのキーを追加
  return playerJoinLogList.map((log) => {
    const matchingRange = dateRanges.find(({ start, end }) => {
      if (end === null) {
        return log.joinDateTime >= start;
      }
      return log.joinDateTime >= start && log.joinDateTime < end;
    });
    return { ...log, range_key: matchingRange?.key ?? 'unknown' };
  });
};

/**
 * 最後に検出されたプレイヤー参加ログを取得する
 * ログ同期の進捗確認に使用される
 */
export const findLatestPlayerJoinLog =
  async (): Promise<VRChatPlayerJoinLogModel | null> =>
    getDB()
      .select()
      .from(vrchatPlayerJoinLogs)
      .orderBy(desc(vrchatPlayerJoinLogs.joinDateTime))
      .limit(1)
      .get() ?? null;

/**
 * 出会ったプレイヤーの数を数える。
 *
 * 古いログには playerId が無いため、全期間で値を持つ playerName の重複を除いて数える。
 * 表示名を変えたプレイヤーは別人として数えられる。
 * 起動画面の統計（initProgress/stats.ts）から呼び出される。
 */
export const countDistinctPlayerNames = async (): Promise<number> =>
  getDB()
    .select({ count: countDistinct(vrchatPlayerJoinLogs.playerName) })
    .from(vrchatPlayerJoinLogs)
    .get()?.count ?? 0;
