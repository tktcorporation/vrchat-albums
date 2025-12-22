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
  createIndexDecorator,
  Default,
  NotNull,
  PrimaryKey,
  Table,
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

const JoinDateTimeFromPhotoIndex = createIndexDecorator(
  'JoinDateTimeFromPhotoIndex',
  {
    name: 'photo-joinDateTime-idx',
    concurrently: true,
  },
);

@Table({ tableName: 'VRChatWorldJoinLogFromPhotoModels' })
/**
 * 写真から抽出したワールド入室情報を保存するモデル。
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see docs/log-sync-architecture.md - ログ同期の設計
 * @see VRChatWorldJoinLogModel - ログ由来のワールド入室情報
 */
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
  @JoinDateTimeFromPhotoIndex
  declare joinDateTime: Date;

  @Attribute(DataTypes.DATE)
  @Default(DataTypes.NOW)
  @NotNull
  declare createdAt: CreationOptional<Date>;

  @Attribute(DataTypes.DATE)
  declare updatedAt: CreationOptional<Date>;
}

/**
 * 写真から抽出したワールド入室情報をデータベースに保存する。
 * サービス層から呼び出される実体モデル操作関数。
 */
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

/**
 * 保存済みの写真由来ワールド入室ログを取得するモデル関数。
 * controller 層やテストから利用される。
 */
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
