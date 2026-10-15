import type { Transaction } from '@sequelize/core';
import { Effect } from 'effect';

import { type DBHelperError, enqueueTask } from '../../lib/dbHelper';
import type { VRChatWorldJoinLog } from '../vrchatLog/service';
import * as model from './VRChatWorldJoinLogModel/s_model';

/**
 * ワールド参加ログをDBへ保存する
 * loadLogInfoIndexFromVRChatLog から利用される
 */
export const createVRChatWorldJoinLogModel = (
  vrchatWorldJoinLogList: VRChatWorldJoinLog[],
  options?: { transaction?: Transaction },
): Effect.Effect<model.VRChatWorldJoinLogModel[], DBHelperError> => {
  return Effect.tryPromise({
    try: () =>
      model.createVRChatWorldJoinLog(
        vrchatWorldJoinLogList,
        options?.transaction,
      ),
    catch: (error): DBHelperError => ({
      type: 'BATCH_OPERATION_FAILED',
      message: `Failed to create world join logs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
  });
};

/**
 * すべてのワールド参加ログを取得する
 * デバッグ用のAPIから参照される
 */
export const findAllVRChatWorldJoinLogList = (): Effect.Effect<
  model.VRChatWorldJoinLogModel[],
  DBHelperError
> => {
  return Effect.tryPromise({
    try: () => model.findAllVRChatWorldJoinLogList(),
    catch: (error): DBHelperError => ({
      type: 'BATCH_OPERATION_FAILED',
      message: `Failed to find all world join logs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
  });
};

export const findVRChatWorldJoinLogList = async ({
  gtJoinDateTime,
  ltJoinDateTime,
  orderByJoinDateTime,
  limit,
}: {
  gtJoinDateTime?: Date;
  ltJoinDateTime?: Date;
  orderByJoinDateTime: 'asc' | 'desc';
  limit?: number;
}) => {
  const modelList = await model.findVRChatWorldJoinLogList({
    gtJoinDateTime,
    ltJoinDateTime,
    orderByJoinDateTime,
    limit,
  });
  return modelList.map((m) => {
    return {
      id: m.id as string,
      worldId: m.worldId,
      worldName: m.worldName,
      worldInstanceId: m.worldInstanceId,
      joinDateTime: m.joinDateTime,
      createdAt: m.createdAt as Date,
      updatedAt: m.updatedAt as Date | null,
    };
  });
};

/**
 * 最も新しいワールド参加ログを取得する
 * ログ同期処理で基準日時を求める際に使用
 */
export const findLatestWorldJoinLog = (): Effect.Effect<
  model.VRChatWorldJoinLogModel | null,
  DBHelperError
> => {
  return enqueueTask(() => model.findLatestWorldJoinLog());
};

interface VRChatWorldJoinLogWithSource {
  id: string;
  worldId: string;
  worldName: string;
  worldInstanceId: string;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date | null;
}

/**
 * 通常のログと写真から取得したログをマージします
 * 重複がある場合は通常のログを優先します
 */
export const mergeVRChatWorldJoinLogs = ({
  normalLogs,
  photoLogs,
}: {
  normalLogs: VRChatWorldJoinLogWithSource[];
  photoLogs: {
    id: string;
    worldId: string;
    joinDate: Date;
    createdAt: Date;
    updatedAt: Date | null;
  }[];
}): VRChatWorldJoinLogWithSource[] => {
  // 写真から取得したログを通常のログの形式に変換
  const convertedPhotoLogs: VRChatWorldJoinLogWithSource[] = photoLogs.map(
    (log) => ({
      id: log.id,
      worldId: log.worldId,
      worldName: log.worldId, // 写真からは取得できない
      worldInstanceId: '', // 写真からは取得できない
      joinDateTime: log.joinDate,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    }),
  );

  // 写真から取得したログから、通常のログと重複するもの（worldId と参加日時が一致）を除外する。
  // 件数が多くても線形時間で済むよう、通常ログの識別キーを Set に入れて照合する
  const identityKey = (worldId: string, joinDateTime: Date) =>
    `${worldId}\u0000${joinDateTime.getTime()}`;
  const normalLogKeys = new Set(
    normalLogs.map((normalLog) =>
      identityKey(normalLog.worldId, normalLog.joinDateTime),
    ),
  );
  const uniquePhotoLogs = convertedPhotoLogs.filter(
    (photoLog) =>
      !normalLogKeys.has(identityKey(photoLog.worldId, photoLog.joinDateTime)),
  );

  return [...normalLogs, ...uniquePhotoLogs];
};
