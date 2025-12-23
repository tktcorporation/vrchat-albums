import { Op } from '@sequelize/core';
import { VRChatPlayerLeaveLogModel } from './playerLeaveLog.model';

export const createVRChatPlayerLeaveLogModel = async (
  leaveLogList: Array<{
    leaveDate: Date;
    playerName: string;
    playerId: string | null;
  }>,
): Promise<VRChatPlayerLeaveLogModel[]> => {
  const newLogs = leaveLogList.map((logInfo) => ({
    leaveDateTime: logInfo.leaveDate,
    playerName: logInfo.playerName,
    playerId: logInfo.playerId,
  }));

  if (newLogs.length > 0) {
    const vrchatPlayerLeaveLog = await VRChatPlayerLeaveLogModel.bulkCreate(
      newLogs,
      {
        ignoreDuplicates: true,
        validate: true,
      },
    );

    return vrchatPlayerLeaveLog;
  }

  return [];
};

export const findLatestPlayerLeaveLog = async () => {
  return await VRChatPlayerLeaveLogModel.findOne({
    order: [['leaveDateTime', 'DESC']],
  });
};

export const findVRChatPlayerLeaveLogList = async (query?: {
  gtLeaveDateTime?: Date;
  ltLeaveDateTime?: Date;
  orderByLeaveDateTime: 'asc' | 'desc';
}): Promise<VRChatPlayerLeaveLogModel[]> => {
  const playerLeaveLogList = await VRChatPlayerLeaveLogModel.findAll({
    where: {
      leaveDateTime: {
        ...(query?.gtLeaveDateTime && { [Op.gt]: query.gtLeaveDateTime }),
        ...(query?.ltLeaveDateTime && { [Op.lt]: query.ltLeaveDateTime }),
      },
    },
    order: [['leaveDateTime', query?.orderByLeaveDateTime ?? 'asc']],
  });

  return playerLeaveLogList;
};
