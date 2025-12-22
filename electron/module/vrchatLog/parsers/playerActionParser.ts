import * as datefns from 'date-fns';
import { err, fromThrowable, ok, type Result } from 'neverthrow';
import type { VRChatLogLine, VRChatPlayerId, VRChatPlayerName } from '../model';
import { OptionalVRChatPlayerIdSchema, VRChatPlayerNameSchema } from '../model';

export interface VRChatPlayerJoinLog {
  logType: 'playerJoin';
  joinDate: Date;
  playerName: VRChatPlayerName;
  playerId: VRChatPlayerId | null;
}

export interface VRChatPlayerLeaveLog {
  logType: 'playerLeave';
  leaveDate: Date;
  playerName: VRChatPlayerName;
  playerId: VRChatPlayerId | null;
}

export type VRChatPlayerActionLog = VRChatPlayerJoinLog | VRChatPlayerLeaveLog;

/**
 * プレイヤーアクションパースのエラー種別
 */
export type PlayerActionParseError =
  | 'LOG_FORMAT_MISMATCH' // ログ形式が期待される形式と一致しない
  | 'INVALID_PLAYER_NAME' // プレイヤー名が無効
  | 'INVALID_PLAYER_ID' // プレイヤーIDが無効な形式
  | 'DATE_PARSE_ERROR'; // 日付のパースエラー

/**
 * プレイヤーアクション（参加・退出）ログのパース機能
 */
const parsePlayerInfo = (
  playerName: string,
  playerId: string | undefined,
): Result<
  { playerName: VRChatPlayerName; playerId: VRChatPlayerId | null },
  PlayerActionParseError
> => {
  // プレイヤー名の検証
  const playerNameResult = VRChatPlayerNameSchema.safeParse(playerName);
  if (!playerNameResult.success) {
    return err('INVALID_PLAYER_NAME');
  }

  // プレイヤーIDの検証
  const playerIdResult = OptionalVRChatPlayerIdSchema.safeParse(
    playerId || null,
  );
  if (!playerIdResult.success) {
    return err('INVALID_PLAYER_ID');
  }

  return ok({
    playerName: playerNameResult.data,
    playerId: playerIdResult.data,
  });
};

/**
 * プレイヤー参加ログから情報を抽出
 * @param logLine プレイヤー参加のログ行
 * @returns プレイヤー参加情報のResult
 */
export const extractPlayerJoinInfoFromLog = (
  logLine: VRChatLogLine,
): Result<VRChatPlayerJoinLog, PlayerActionParseError> => {
  // 2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined プレイヤーA (usr_8862b082-dbc8-4b6d-8803-e834f833b498)
  const regex =
    /(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2}).*\[Behaviour\] OnPlayerJoined (.+?)(?:\s+\((usr_[^)]+)\))?$/;
  const matches = logLine.value.match(regex);

  if (!matches) {
    return err('LOG_FORMAT_MISMATCH');
  }

  const [, date, time, playerName, playerId] = matches;

  // 日付のパース
  const safeDateParse = fromThrowable(
    () => datefns.parse(`${date} ${time}`, 'yyyy.MM.dd HH:mm:ss', new Date()),
    () => 'DATE_PARSE_ERROR' as const,
  );

  const joinDate = safeDateParse();
  if (joinDate.isErr()) {
    return err(joinDate.error);
  }

  // プレイヤー情報のパース
  const playerInfo = parsePlayerInfo(playerName, playerId);
  if (playerInfo.isErr()) {
    return err(playerInfo.error);
  }

  return ok({
    logType: 'playerJoin',
    joinDate: joinDate.value,
    ...playerInfo.value,
  });
};

/**
 * プレイヤー退出ログから情報を抽出
 * @param logLine プレイヤー退出のログ行
 * @returns プレイヤー退出情報のResult
 */
export const extractPlayerLeaveInfoFromLog = (
  logLine: VRChatLogLine,
): Result<VRChatPlayerLeaveLog, PlayerActionParseError> => {
  // 2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft プレイヤー ⁄ A (usr_34a27988-a7e4-4d5e-a49a-ae5975422779)
  // 2025.02.22 21:14:48 Debug      -  [Behaviour] OnPlayerLeft tkt (usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0)
  const regex =
    /(\d{4}\.\d{2}\.\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+-\s+\[Behaviour\] OnPlayerLeft (.+?)(?:\s+\((usr_[^)]+)\))?$/;
  const matches = logLine.value.match(regex);

  if (!matches) {
    return err('LOG_FORMAT_MISMATCH');
  }

  const [, date, time, playerName, playerId] = matches;

  // 日付のパース（ピリオドをハイフンに変換）
  const processedDate = date.replace(/\./g, '-');
  const safeDateParse = fromThrowable(
    () =>
      datefns.parse(
        `${processedDate} ${time}`,
        'yyyy-MM-dd HH:mm:ss',
        new Date(),
      ),
    () => 'DATE_PARSE_ERROR' as const,
  );

  const leaveDate = safeDateParse();
  if (leaveDate.isErr()) {
    return err(leaveDate.error);
  }

  // プレイヤー情報のパース
  const playerInfo = parsePlayerInfo(playerName, playerId);
  if (playerInfo.isErr()) {
    return err(playerInfo.error);
  }

  return ok({
    logType: 'playerLeave',
    leaveDate: leaveDate.value,
    ...playerInfo.value,
  });
};
