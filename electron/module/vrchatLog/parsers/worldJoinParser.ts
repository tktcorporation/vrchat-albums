import { Effect } from 'effect';

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
 * ワールド参加ログのパースエラー型
 *
 * 予期されたエラーのみ含む。予期しないエラーは throw して Sentry に送信する。
 */
export type WorldJoinParseError =
  | { type: 'LOG_FORMAT_MISMATCH' }
  | { type: 'INVALID_WORLD_ID'; worldId: string }
  | { type: 'INVALID_INSTANCE_ID'; instanceId: string; worldId: string }
  | { type: 'WORLD_NAME_NOT_FOUND' };

/**
 * ワールド参加ログのパース機能
 */

/**
 * ログエントリーからワールド参加情報を抽出
 *
 * VRChat ログの "Joining" 行からワールドID・インスタンスID・ワールド名を抽出する。
 * VRChat のログ形式には以下のバリエーションがある:
 * - 標準形式: `Joining wrld_xxx:instanceId`
 * - インスタンスIDなし: `Joining wrld_xxx` (ローカルワールドや新しいログ形式)
 *
 * インスタンスIDが存在しない、または不正な形式の場合はエラーを返す。
 *
 * @param logLines ログ行の配列
 * @param index 現在処理中のログ行のインデックス
 * @returns ワールド参加情報、またはエラー
 */
export const extractWorldJoinInfoFromLogs = (
  logLines: VRChatLogLine[],
  index: number,
): Effect.Effect<VRChatWorldJoinLog, WorldJoinParseError> => {
  const logEntry = logLines[index];

  // コロンとインスタンスIDをオプショナルにしたパターン
  // - グループ3: wrld_xxx (ワールドID)
  // - グループ5: インスタンスID (存在する場合のみ)
  const regex =
    /(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2}) .* \[Behaviour\] Joining (wrld_[a-f0-9-]+)(:(.*))?$/;
  const matches = logEntry.match(regex);

  if (!matches) {
    return Effect.fail({ type: 'LOG_FORMAT_MISMATCH' });
  }

  const date = matches[1];
  const time = matches[2];
  const worldId = matches[3];
  // matches[4] はコロン付き全体 (e.g. ":12345"), matches[5] がインスタンスID部分
  const instanceId = matches[5];

  // ワールドIDの検証
  const worldIdResult = VRChatWorldIdSchema.safeParse(worldId);
  if (!worldIdResult.success) {
    return Effect.fail({ type: 'INVALID_WORLD_ID', worldId });
  }
  const validatedWorldId = worldIdResult.data;

  // インスタンスIDの検証
  // VRChat ログにインスタンスIDが含まれない場合（ローカルワールド等）や、
  // 予期しない形式の場合（wrld_xxx がインスタンスIDとして記録される等）はエラーを返す
  if (instanceId === undefined || instanceId === '') {
    return Effect.fail({
      type: 'INVALID_INSTANCE_ID',
      instanceId: instanceId ?? '',
      worldId,
    });
  }

  const instanceIdResult = VRChatWorldInstanceIdSchema.safeParse(instanceId);
  if (!instanceIdResult.success) {
    return Effect.fail({ type: 'INVALID_INSTANCE_ID', instanceId, worldId });
  }
  const validatedInstanceId = instanceIdResult.data;

  let foundWorldName: string | null = null;

  // 後続のログ行からワールド名を抽出
  // VRChat のログでは "Joining or Creating Room:" は "Joining wrld_" の直後数行以内に出現する。
  // 全残り行をスキャンすると O(n²) になるため、最大20行に限定して前方検索する。
  // 実測値: 通常は 2-5行以内に出現。20行は安全マージンを含んだ上限値。
  // VRChat のログ形式が変わり、20行以上離れるケースが発生した場合は上限を引き上げること。
  const WORLD_NAME_SEARCH_LIMIT = 20;
  const worldNameRegex = /\[Behaviour\] Joining or Creating Room: (.+)/;
  const searchEnd = Math.min(
    index + 1 + WORLD_NAME_SEARCH_LIMIT,
    logLines.length,
  );
  for (let i = index + 1; i < searchEnd; i++) {
    const [, worldName] = logLines[i].match(worldNameRegex) ?? [];
    if (worldName) {
      foundWorldName = worldName;
      break;
    }
  }

  if (!foundWorldName) {
    return Effect.fail({ type: 'WORLD_NAME_NOT_FOUND' });
  }

  const joinDate = parseLogDateTime(date, time);
  const validatedWorldName = VRChatWorldNameSchema.parse(foundWorldName);

  return Effect.succeed({
    logType: 'worldJoin',
    joinDate,
    worldInstanceId: validatedInstanceId,
    worldId: validatedWorldId,
    worldName: validatedWorldName,
  });
};
