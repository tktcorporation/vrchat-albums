import { ResultAsync } from 'neverthrow';
import { type DBHelperError, enqueueTask } from '../../lib/dbHelper';
import type { VRChatWorldJoinLog } from '../vrchatLog/service';
import * as model from './VRChatWorldJoinLogModel/s_model';

/**
 * ワールド参加ログをDBへ保存する
 * loadLogInfoIndexFromVRChatLog から利用される
 */
export const createVRChatWorldJoinLogModel = (
  vrchatWorldJoinLogList: VRChatWorldJoinLog[],
): ResultAsync<model.VRChatWorldJoinLogModel[], DBHelperError> => {
  return ResultAsync.fromPromise(
    model.createVRChatWorldJoinLog(vrchatWorldJoinLogList),
    (error): DBHelperError => ({
      type: 'BATCH_OPERATION_FAILED',
      message: `Failed to create world join logs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
  );
};

/**
 * すべてのワールド参加ログを取得する
 * デバッグ用のAPIから参照される
 */
export const findAllVRChatWorldJoinLogList = (): ResultAsync<
  model.VRChatWorldJoinLogModel[],
  DBHelperError
> => {
  return ResultAsync.fromPromise(
    model.findAllVRChatWorldJoinLogList(),
    (error): DBHelperError => ({
      type: 'BATCH_OPERATION_FAILED',
      message: `Failed to find all world join logs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
  );
};

export const findVRChatWorldJoinLogList = async ({
  gtJoinDateTime,
  ltJoinDateTime,
  orderByJoinDateTime,
}: {
  gtJoinDateTime?: Date;
  ltJoinDateTime?: Date;
  orderByJoinDateTime: 'asc' | 'desc';
}) => {
  const modelList = await model.findVRChatWorldJoinLogList({
    gtJoinDateTime,
    ltJoinDateTime,
    orderByJoinDateTime,
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

export const findRecentVRChatWorldJoinLog = (
  joinDateTime: Date,
): ResultAsync<model.VRChatWorldJoinLogModel | null, DBHelperError> => {
  return ResultAsync.fromSafePromise(
    enqueueTask(() =>
      model.findRecentVRChatWorldJoinLog({
        dateTime: joinDateTime,
      }),
    ),
  ).andThen((result) => result);
};

export const findNextVRChatWorldJoinLog = (
  joinDateTime: Date,
): ResultAsync<model.VRChatWorldJoinLogModel | null, DBHelperError> => {
  return ResultAsync.fromSafePromise(
    enqueueTask(() => model.findNextVRChatWorldJoinLog(joinDateTime)),
  ).andThen((result) => result);
};

/**
 * 最も新しいワールド参加ログを取得する
 * ログ同期処理で基準日時を求める際に使用
 */
export const findLatestWorldJoinLog = (): ResultAsync<
  model.VRChatWorldJoinLogModel | null,
  DBHelperError
> => {
  return ResultAsync.fromSafePromise(
    enqueueTask(() => model.findLatestWorldJoinLog()),
  ).andThen((result) => result);
};

type VRChatWorldJoinLogWithSource = {
  id: string;
  worldId: string;
  worldName: string;
  worldInstanceId: string;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date | null;
};

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

  // 写真から取得したログから、通常のログと重複するものを除外
  const uniquePhotoLogs = convertedPhotoLogs.filter((photoLog) => {
    return !normalLogs.some(
      (normalLog) =>
        normalLog.worldId === photoLog.worldId &&
        normalLog.joinDateTime.getTime() === photoLog.joinDateTime.getTime(),
    );
  });

  return [...normalLogs, ...uniquePhotoLogs];
};
