import {
  type CreationOptional,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  Op,
} from '@sequelize/core';
import {
  Attribute,
  Default,
  NotNull,
  PrimaryKey,
  Table,
  createIndexDecorator,
} from '@sequelize/core/decorators-legacy';
import { uuidv7 } from 'uuidv7';

import type { WorldId } from '../vrchatLog/type';

export interface VRChatWorldJoinLogFromPhoto {
  joinDate: Date;
  worldId: WorldId;
}

const WorldInstanceIdJoinDateTimeFromPhotoIndex = createIndexDecorator(
  'WorldInstanceIdJoinDateTimeFromPhotoIndex',
  {
    name: 'worldInstanceId-joinDateTime-fromPhoto',
    type: 'fulltext',
    concurrently: true,
    unique: true,
  },
);

@Table({ tableName: 'VRChatWorldJoinLogFromPhotoModels' })
export class VRChatWorldJoinLogFromPhotoModel extends Model<
  InferAttributes<VRChatWorldJoinLogFromPhotoModel>,
  InferCreationAttributes<VRChatWorldJoinLogFromPhotoModel>
> {
  @Attribute(DataTypes.UUID)
  @PrimaryKey
  @Default(uuidv7)
  declare id: CreationOptional<string>;

  @Attribute(DataTypes.STRING)
  @NotNull
  @WorldInstanceIdJoinDateTimeFromPhotoIndex
  declare worldId: WorldId;

  @Attribute(DataTypes.DATE)
  @NotNull
  @WorldInstanceIdJoinDateTimeFromPhotoIndex
  declare joinDateTime: Date;

  @Attribute(DataTypes.DATE)
  @Default(DataTypes.NOW)
  @NotNull
  declare createdAt: CreationOptional<Date>;

  @Attribute(DataTypes.DATE)
  declare updatedAt: CreationOptional<Date>;
}

export const createVRChatWorldJoinLogFromPhoto = async (
  vrchatWorldJoinLogFromPhotoList: VRChatWorldJoinLogFromPhoto[],
): Promise<VRChatWorldJoinLogFromPhotoModel[]> => {
  const newLogs = vrchatWorldJoinLogFromPhotoList.map((logInfo) => ({
    joinDateTime: logInfo.joinDate,
    worldId: logInfo.worldId,
  }));

  if (newLogs.length === 0) {
    return [];
  }

  const vrchatWorldJoinLog = await VRChatWorldJoinLogFromPhotoModel.bulkCreate(
    newLogs,
    {
      ignoreDuplicates: true,
      validate: true,
    },
  );

  return vrchatWorldJoinLog;
};

export const findVRChatWorldJoinLogFromPhotoList = async (query?: {
  gtJoinDateTime?: Date;
  ltJoinDateTime?: Date;
  orderByJoinDateTime: 'asc' | 'desc';
}): Promise<VRChatWorldJoinLogFromPhotoModel[]> => {
  const logs = await VRChatWorldJoinLogFromPhotoModel.findAll({
    where: {
      joinDateTime: {
        ...(query?.gtJoinDateTime && { [Op.gt]: query.gtJoinDateTime }),
        ...(query?.ltJoinDateTime && { [Op.lt]: query.ltJoinDateTime }),
      },
    },
    order: [['joinDateTime', query?.orderByJoinDateTime ?? 'asc']],
  });

  return logs;
};
