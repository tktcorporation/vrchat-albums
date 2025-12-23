import type {
  VRChatLogLine,
  VRChatWorldId,
  VRChatWorldInstanceId,
  VRChatWorldName,
} from '../model';
import {
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from '../model';
import { parseLogDateTime } from './baseParser';

export interface VRChatWorldJoinLog {
  logType: 'worldJoin';
  joinDate: Date;
  worldId: VRChatWorldId;
  worldInstanceId: VRChatWorldInstanceId;
  worldName: VRChatWorldName;
}

/**
 * ワールド参加ログのパース機能
 */

/**
 * ログエントリーからワールド参加情報を抽出
 * @param logLines ログ行の配列
 * @param index 現在処理中のログ行のインデックス
 * @returns ワールド参加情報、または抽出できない場合null
 */
export const extractWorldJoinInfoFromLogs = (
  logLines: VRChatLogLine[],
  index: number,
): VRChatWorldJoinLog | null => {
  const logEntry = logLines[index];
  const regex =
    /(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2}) .* \[Behaviour\] Joining (wrld_[a-f0-9-]+):(.*)/;
  const matches = logEntry.match(regex);

  if (!matches || matches.length < 4) {
    return null;
  }

  const date = matches[1];
  const time = matches[2];
  const worldId = matches[3];
  const instanceId = matches[4];

  // valueObjectsを使用して型安全に検証
  const validatedWorldId = VRChatWorldIdSchema.parse(worldId);
  const validatedInstanceId = VRChatWorldInstanceIdSchema.parse(instanceId);

  let foundWorldName: string | null = null;

  // 後続のログ行からワールド名を抽出
  for (const l of logLines.slice(index + 1)) {
    const worldNameRegex = /\[Behaviour\] Joining or Creating Room: (.+)/;
    const [, worldName] = l.match(worldNameRegex) || [];
    if (worldName && !foundWorldName) {
      foundWorldName = worldName;
    }
  }

  if (foundWorldName) {
    const joinDate = parseLogDateTime(date, time);
    const validatedWorldName = VRChatWorldNameSchema.parse(foundWorldName);

    return {
      logType: 'worldJoin',
      joinDate,
      worldInstanceId: validatedInstanceId,
      worldId: validatedWorldId,
      worldName: validatedWorldName,
    };
  }

  throw new Error(
    'Failed to extract world name from the subsequent log entries',
  );
};
