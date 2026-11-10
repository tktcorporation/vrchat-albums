import { and, asc, desc, gt, lt } from 'drizzle-orm';

import { getDB } from '../../lib/db/client';
import { vrchatPlayerLeaveLogs } from '../../lib/db/schema';
import {
  createVRChatPlayerLeaveLogs,
  type VRChatPlayerLeaveLogModel,
} from './playerLeaveLog.model';

export const createVRChatPlayerLeaveLogModel = async (
  leaveLogList: {
    leaveDate: Date;
    playerName: string;
    playerId: string | null;
  }[],
): Promise<VRChatPlayerLeaveLogModel[]> =>
  createVRChatPlayerLeaveLogs(
    leaveLogList.map((logInfo) => ({
      leaveDateTime: logInfo.leaveDate,
      playerName: logInfo.playerName,
      playerId: logInfo.playerId,
    })),
  );

export const findLatestPlayerLeaveLog =
  async (): Promise<VRChatPlayerLeaveLogModel | null> =>
    getDB()
      .select()
      .from(vrchatPlayerLeaveLogs)
      .orderBy(desc(vrchatPlayerLeaveLogs.leaveDateTime))
      .limit(1)
      .get() ?? null;

export const findVRChatPlayerLeaveLogList = async (query?: {
  gtLeaveDateTime?: Date;
  ltLeaveDateTime?: Date;
  orderByLeaveDateTime: 'asc' | 'desc';
}): Promise<VRChatPlayerLeaveLogModel[]> => {
  const column = vrchatPlayerLeaveLogs.leaveDateTime;
  return getDB()
    .select()
    .from(vrchatPlayerLeaveLogs)
    .where(
      and(
        query?.gtLeaveDateTime ? gt(column, query.gtLeaveDateTime) : undefined,
        query?.ltLeaveDateTime ? lt(column, query.ltLeaveDateTime) : undefined,
      ),
    )
    .orderBy(
      query?.orderByLeaveDateTime === 'desc' ? desc(column) : asc(column),
    )
    .all();
};
