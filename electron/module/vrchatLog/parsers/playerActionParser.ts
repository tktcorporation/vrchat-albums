import * as datefns from 'date-fns';
import { Effect } from 'effect';

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
): Effect.Effect<
  { playerName: VRChatPlayerName; playerId: VRChatPlayerId | null },
  PlayerActionParseError
> => {
  // プレイヤー名の検証
  const playerNameResult = VRChatPlayerNameSchema.safeParse(playerName);
  if (!playerNameResult.success) {
    return Effect.fail('INVALID_PLAYER_NAME');
  }

  // プレイヤーIDの検証
  const playerIdResult = OptionalVRChatPlayerIdSchema.safeParse(
    playerId || null,
  );
  if (!playerIdResult.success) {
    return Effect.fail('INVALID_PLAYER_ID');
  }

  return Effect.succeed({
    playerName: playerNameResult.data,
    playerId: playerIdResult.data,
  });
};

/**
 * プレイヤー参加ログから情報を抽出
 * @param logLine プレイヤー参加のログ行
 * @returns プレイヤー参加情報のEffect
 */
export const extractPlayerJoinInfoFromLog = (
  logLine: VRChatLogLine,
): Effect.Effect<VRChatPlayerJoinLog, PlayerActionParseError> => {
  // 2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined プレイヤーA (usr_8862b082-dbc8-4b6d-8803-e834f833b498)
  const regex =
    /(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2}).*\[Behaviour\] OnPlayerJoined (.+?)(?:\s+\((usr_[^)]+)\))?$/;
  const matches = logLine.match(regex);

  if (!matches) {
    return Effect.fail('LOG_FORMAT_MISMATCH');
  }

  const [, date, time, playerName, playerId] = matches;

  // 日付のパース
  const joinDate = Effect.try({
    try: () =>
      datefns.parse(`${date} ${time}`, 'yyyy.MM.dd HH:mm:ss', new Date()),
    catch: () => 'DATE_PARSE_ERROR' as const,
  });

  return Effect.gen(function* () {
    const parsedDate = yield* joinDate;
    const playerInfo = yield* parsePlayerInfo(playerName, playerId);

    return {
      logType: 'playerJoin' as const,
      joinDate: parsedDate,
      ...playerInfo,
    };
  });
};

/**
 * プレイヤー退出ログから情報を抽出
 * @param logLine プレイヤー退出のログ行
 * @returns プレイヤー退出情報のEffect
 */
export const extractPlayerLeaveInfoFromLog = (
  logLine: VRChatLogLine,
): Effect.Effect<VRChatPlayerLeaveLog, PlayerActionParseError> => {
  // 2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft プレイヤー ⁄ A (usr_34a27988-a7e4-4d5e-a49a-ae5975422779)
  // 2025.02.22 21:14:48 Debug      -  [Behaviour] OnPlayerLeft tkt (usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0)
  const regex =
    /(\d{4}\.\d{2}\.\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+-\s+\[Behaviour\] OnPlayerLeft (.+?)(?:\s+\((usr_[^)]+)\))?$/;
  const matches = logLine.match(regex);

  if (!matches) {
    return Effect.fail('LOG_FORMAT_MISMATCH');
  }

  const [, date, time, playerName, playerId] = matches;

  // 日付のパース（ピリオドをハイフンに変換）
  const processedDate = date.replace(/\./g, '-');
  const leaveDate = Effect.try({
    try: () =>
      datefns.parse(
        `${processedDate} ${time}`,
        'yyyy-MM-dd HH:mm:ss',
        new Date(),
      ),
    catch: () => 'DATE_PARSE_ERROR' as const,
  });

  return Effect.gen(function* () {
    const parsedDate = yield* leaveDate;
    const playerInfo = yield* parsePlayerInfo(playerName, playerId);

    return {
      logType: 'playerLeave' as const,
      leaveDate: parsedDate,
      ...playerInfo,
    };
  });
};
