import type { VRChatWorldJoinLogFromPhoto } from './vrchatWorldJoinLogFromPhoto.model';
import * as Model from './vrchatWorldJoinLogFromPhoto.model';

/**
 * モデル層の createVRChatWorldJoinLogFromPhoto を呼び出し、
 * 引数ログ情報を保存するサービス関数。
 */
export const createVRChatWorldJoinLogFromPhoto = async (
  logs: VRChatWorldJoinLogFromPhoto[],
) => {
  const createdLogs = await Model.createVRChatWorldJoinLogFromPhoto(
    logs.map((log) => ({
      worldId: log.worldId,
      joinDate: log.joinDate,
    })),
  );

  return createdLogs;
};

/**
 * 写真由来のワールド参加ログを取得するサービス関数。
 * コントローラから利用され、モデルの検索結果を整形して返す。
 */
export const findVRChatWorldJoinLogFromPhotoList = async (query?: {
  gtJoinDateTime?: Date;
  ltJoinDateTime?: Date;
  orderByJoinDateTime: 'asc' | 'desc';
}) => {
  const modelList = await Model.findVRChatWorldJoinLogFromPhotoList(query);
  return modelList.map((m) => {
    return {
      id: m.id as string,
      worldId: m.worldId,
      joinDate: m.joinDateTime,
      createdAt: m.createdAt as Date,
      updatedAt: m.updatedAt as Date | null,
    };
  });
};
