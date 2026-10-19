import { VRChatPhotoPathObjectSchema } from '../../../lib/pathObject';
import { createVRChatWorldJoinLogFromPhoto } from '../../vrchatWorldJoinLogFromPhoto/service';
import type { VRChatWorldJoinLogFromPhoto } from '../../vrchatWorldJoinLogFromPhoto/vrchatWorldJoinLogFromPhoto.model';
import type { WorldId } from '../type';

/**
 * 写真ファイル名からログ情報をインポートする機能
 * 旧アプリで生成された写真ファイル名にはワールドIDと参加日時が含まれている
 */

/**
 * 写真ファイルのパスからワールド参加ログを抽出する
 * ファイル名のパターン:
 * VRChat_YYYY-MM-DD_HH-mm-ss.SSS_wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.ext
 * このパターンに合わないパスは捨てる
 */
const getLogLinesFromPhotoPaths = (
  photoPaths: readonly string[],
): VRChatWorldJoinLogFromPhoto[] =>
  photoPaths
    .map((filePath) => {
      const photoInfo =
        VRChatPhotoPathObjectSchema.parse(filePath).extractPhotoInfo();
      if (!photoInfo) {
        return null;
      }
      return {
        joinDate: photoInfo.joinDate,
        worldId: photoInfo.worldId as WorldId,
      };
    })
    .filter((log) => log !== null);

/**
 * 写真として保存されているワールドへのJoinログをデータベースに保存
 *
 * パスの列挙は写真インデックスの作成（createVRChatPhotoPathIndex の worldJoinPhotoPaths）が担う。
 * 写真フォルダを辿るのはインデックス作成の 1 回だけにするため、ここではパスを受け取るだけにしている。
 * @param photoPaths ファイル名にワールドIDを含む写真の候補の絶対パス
 */
export const importLogLinesFromPhotoPaths = async ({
  photoPaths,
}: Readonly<{
  photoPaths: readonly string[];
}>): Promise<void> => {
  const worldJoinLogs = getLogLinesFromPhotoPaths(photoPaths);
  await createVRChatWorldJoinLogFromPhoto(worldJoinLogs);
};
