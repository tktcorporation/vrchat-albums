import { glob } from 'glob';
import { VRChatPhotoPathObjectSchema } from '../../../lib/pathObject';
import type { VRChatPhotoDirPath } from '../../vrchatPhoto/valueObjects';
import { createVRChatWorldJoinLogFromPhoto } from '../../vrchatWorldJoinLogFromPhoto/service';
import type { VRChatWorldJoinLogFromPhoto } from '../../vrchatWorldJoinLogFromPhoto/vrchatWorldJoinLogFromPhoto.model';

type WorldId = `wrld_${string}`;

/**
 * 写真ファイル名からログ情報をインポートする機能
 * 旧アプリで生成された写真ファイル名にはワールドIDと参加日時が含まれている
 */

/**
 * 写真ディレクトリからワールド参加ログを抽出
 * @param vrChatPhotoDirPath VRChat写真ディレクトリのパス
 * @returns ワールド参加ログの配列
 */
const getLogLinesFromLogPhotoDirPath = async ({
  vrChatPhotoDirPath,
}: {
  vrChatPhotoDirPath: VRChatPhotoDirPath;
}): Promise<VRChatWorldJoinLogFromPhoto[]> => {
  // PathObjectを使用してクロスプラットフォーム対応のglobパターンを生成
  const photoPath = VRChatPhotoPathObjectSchema.parse(vrChatPhotoDirPath.value);
  const globPattern = photoPath.toPhotoGlobPattern();

  // 正規表現にマッチするファイルを再帰的に取得
  const logPhotoFilePathList = await glob(globPattern);

  // ファイル名のパターン:
  // VRChat_YYYY-MM-DD_HH-mm-ss.SSS_wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.ext
  const worldJoinLogList = logPhotoFilePathList
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

  return worldJoinLogList;
};

/**
 * 写真として保存されているワールドへのJoinログをデータベースに保存
 * @param vrChatPhotoDirPath VRChat写真ディレクトリのパス
 */
export const importLogLinesFromLogPhotoDirPath = async ({
  vrChatPhotoDirPath,
}: {
  vrChatPhotoDirPath: VRChatPhotoDirPath;
}): Promise<void> => {
  const logLines = await getLogLinesFromLogPhotoDirPath({
    vrChatPhotoDirPath,
  });

  const worldJoinLogs: VRChatWorldJoinLogFromPhoto[] = logLines.map((log) => ({
    joinDate: log.joinDate,
    worldId: log.worldId,
  }));

  await createVRChatWorldJoinLogFromPhoto(worldJoinLogs);
};
