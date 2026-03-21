import { Cause, Effect, Exit, Option } from 'effect';
import { match } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import type { VRChatLogLine } from '../model';
import {
  extractPlayerJoinInfoFromLog,
  extractPlayerLeaveInfoFromLog,
  type PlayerActionParseError,
  type VRChatPlayerJoinLog,
  type VRChatPlayerLeaveLog,
} from './playerActionParser';
import {
  extractWorldJoinInfoFromLogs,
  type VRChatWorldJoinLog,
  type WorldJoinParseError,
} from './worldJoinParser';
import {
  extractWorldLeaveInfoFromLog,
  inferWorldLeaveEvents,
  type VRChatWorldLeaveLog,
} from './worldLeaveParser';

/**
 * VRChatログのパース機能をまとめたモジュール
 */

/**
 * パース処理のエラー情報
 */
export interface ParseErrorInfo {
  line: string;
  error: string;
  type: 'player_join' | 'player_leave' | 'world_join' | 'world_leave';
}

/**
 * パース処理の結果
 */
export interface ParseResult {
  logInfos: (
    | VRChatWorldJoinLog
    | VRChatWorldLeaveLog
    | VRChatPlayerJoinLog
    | VRChatPlayerLeaveLog
  )[];
  errors: ParseErrorInfo[];
}

/**
 * Effect の Exit から失敗エラーを抽出するヘルパー
 * 型付きエラー（Fail チャネル）のみを抽出し、Defect はそのまま throw する
 */
const extractFailure = <E>(exit: Exit.Exit<unknown, E>): E | null => {
  if (Exit.isSuccess(exit)) return null;
  const failOpt = Cause.failureOption(exit.cause);
  if (Option.isSome(failOpt)) return failOpt.value;
  // Defect の場合はそのまま throw
  const dieOpt = Cause.dieOption(exit.cause);
  if (Option.isSome(dieOpt)) throw dieOpt.value;
  return null;
};

/**
 * ログ行の配列をワールド参加・退出・プレイヤー参加/退出情報に変換
 * @param logLines パース対象のログ行
 * @returns 抽出されたログ情報とエラー情報
 */
export const convertLogLinesToWorldAndPlayerJoinLogInfos = (
  logLines: VRChatLogLine[],
): ParseResult => {
  // TODO: アプリイベントの処理は今後実装
  // | VRChatAppStartLog
  // | VRChatAppExitLog
  const logInfos: (
    | VRChatWorldJoinLog
    | VRChatWorldLeaveLog
    | VRChatPlayerJoinLog
    | VRChatPlayerLeaveLog
  )[] =
    // TODO: アプリイベントの処理は今後実装
    // | VRChatAppStartLog
    // | VRChatAppExitLog
    [];

  const errors: ParseErrorInfo[] = [];

  const worldJoinIndices: number[] = [];

  for (const [index, l] of logLines.entries()) {
    // TODO: アプリイベントの処理は今後実装
    // // アプリ開始ログ (VRC Analytics Initialized)
    // const appStartInfo = extractAppStartInfoFromLog(l);
    // if (appStartInfo) {
    //   logInfos.push(appStartInfo);
    // }

    // アプリ終了ログ (VRCApplication: HandleApplicationQuit)
    // このパターンはworldLeaveParserで処理される
    // const appExitInfo = extractAppExitInfoFromLog(l);
    // if (appExitInfo) {
    //   logInfos.push(appExitInfo);
    // }

    // ワールド参加ログ
    if (l.includes('Joining wrld_')) {
      const exit = Effect.runSyncExit(
        extractWorldJoinInfoFromLogs(logLines, index),
      );

      if (Exit.isSuccess(exit)) {
        logInfos.push(exit.value);
        worldJoinIndices.push(index);
      } else {
        const worldError = extractFailure<WorldJoinParseError>(exit);
        if (!worldError) continue;

        const errorMessage = match(worldError)
          .with(
            { type: 'LOG_FORMAT_MISMATCH' },
            () =>
              'Log format mismatch for world join (line contains "Joining wrld_" but does not match expected regex)',
          )
          .with(
            { type: 'INVALID_WORLD_ID' },
            (e) => `Invalid world ID format: "${e.worldId}"`,
          )
          .with(
            { type: 'INVALID_INSTANCE_ID' },
            (e) =>
              `Invalid instance ID format: "${e.instanceId}" for world "${e.worldId}". ` +
              'VRChat log may contain a world ID without an instance ID (e.g. local world).',
          )
          .with(
            { type: 'WORLD_NAME_NOT_FOUND' },
            () => 'Failed to extract world name from subsequent log entries',
          )
          .exhaustive();

        errors.push({
          line: l,
          error: errorMessage,
          type: 'world_join',
        });

        // Sentry に送信して、どのパターンで例外が起きているか追跡可能にする。
        // LOG_FORMAT_MISMATCH は VRChat のログ形式変更の可能性があるため、
        // 早期検出のために送信する。
        // new Error() で stack trace を保持（Player Join/Leave と同じパターン）。
        logger.error({
          message: new Error(`World join parse error: ${errorMessage}`),
          details: {
            logLine: l,
            errorType: worldError.type,
            ...worldError,
          },
        });
      }
    }

    // ワールド退出ログ（明示的なパターン）
    const leaveInfo = extractWorldLeaveInfoFromLog(l);
    if (leaveInfo) {
      logInfos.push(leaveInfo);
    }

    // プレイヤー参加ログ
    if (l.includes('[Behaviour] OnPlayerJoined')) {
      const exit = Effect.runSyncExit(extractPlayerJoinInfoFromLog(l));

      if (Exit.isSuccess(exit)) {
        logInfos.push(exit.value);
      } else {
        const playerError = extractFailure<PlayerActionParseError>(exit);
        if (!playerError) continue;

        // ログ行からプレイヤー名とIDを抽出（デバッグ用）
        const playerNameMatch = l.match(
          /OnPlayerJoined (.+?)(?:\s+\((usr_[^)]+)\))?$/,
        );
        const playerName = playerNameMatch
          ? playerNameMatch[1]
          : 'Unknown player';
        const playerIdMatch = l.match(/\((usr_[^)]+)\)/);
        const playerId = playerIdMatch
          ? playerIdMatch[1]
          : 'No player ID found';

        // エラータイプに応じた詳細なエラーメッセージを生成
        const errorMessage = match(playerError)
          .with(
            'LOG_FORMAT_MISMATCH',
            () => 'Log format mismatch for player join',
          )
          .with(
            'INVALID_PLAYER_NAME',
            () => `Invalid player name in join log: "${playerName}"`,
          )
          .with(
            'INVALID_PLAYER_ID',
            () =>
              `Invalid player ID format in join log. Player: "${playerName}", ID: "${playerId}"`,
          )
          .with('DATE_PARSE_ERROR', () => 'Failed to parse date in join log')
          .exhaustive();

        // エラー情報を収集
        errors.push({
          line: l,
          error: errorMessage,
          type: 'player_join',
        });

        // エラーログとして記録（自動的にSentryに送信される）
        logger.error({
          message: new Error(`Player join parse error: ${errorMessage}`),
          details: {
            logLine: l,
            playerName,
            playerId,
            errorType: playerError,
          },
        });
      }
    }

    // プレイヤー退出ログ（OnPlayerLeftRoomは除外）
    if (l.includes('OnPlayerLeft') && !l.includes('OnPlayerLeftRoom')) {
      const exit = Effect.runSyncExit(extractPlayerLeaveInfoFromLog(l));

      if (Exit.isSuccess(exit)) {
        logInfos.push(exit.value);
      } else {
        const leaveError = extractFailure<PlayerActionParseError>(exit);
        if (!leaveError) continue;

        // ログ行からプレイヤー名とIDを抽出（デバッグ用）
        const playerNameMatch = l.match(
          /OnPlayerLeft (.+?)(?:\s+\((usr_[^)]+)\))?$/,
        );
        const playerName = playerNameMatch
          ? playerNameMatch[1]
          : 'Unknown player';
        const playerIdMatch = l.match(/\((usr_[^)]+)\)/);
        const playerId = playerIdMatch
          ? playerIdMatch[1]
          : 'No player ID found';

        // エラータイプに応じた詳細なエラーメッセージを生成
        const errorMessage = match(leaveError)
          .with(
            'LOG_FORMAT_MISMATCH',
            () => 'Log format mismatch for player leave',
          )
          .with(
            'INVALID_PLAYER_NAME',
            () => `Invalid player name in leave log: "${playerName}"`,
          )
          .with(
            'INVALID_PLAYER_ID',
            () =>
              `Invalid player ID format in leave log. Player: "${playerName}", ID: "${playerId}"`,
          )
          .with('DATE_PARSE_ERROR', () => 'Failed to parse date in leave log')
          .exhaustive();

        // エラー情報を収集
        errors.push({
          line: l,
          error: errorMessage,
          type: 'player_leave',
        });

        // エラーログとして記録（自動的にSentryに送信される）
        logger.error({
          message: new Error(`Player leave parse error: ${errorMessage}`),
          details: {
            logLine: l,
            playerName,
            playerId,
            errorType: leaveError,
          },
        });
      }
    }
  }

  // 推測されたワールド退出イベントを追加
  const inferredLeaves = inferWorldLeaveEvents(logLines, worldJoinIndices);
  logInfos.push(...inferredLeaves);

  return {
    logInfos,
    errors,
  };
};

// TODO: アプリイベントのパーサーは今後実装
// export {
//   extractAppStartInfoFromLog,
//   extractAppExitInfoFromLog,
//   extractAppVersionInfoFromLog,
// } from './appEventParser';
export { filterLogLinesByDate } from './baseParser';
export type {
  VRChatPlayerJoinLog,
  VRChatPlayerLeaveLog,
} from './playerActionParser';
export {
  extractPlayerJoinInfoFromLog,
  extractPlayerLeaveInfoFromLog,
} from './playerActionParser';
// 型定義の再エクスポート
export type {
  VRChatWorldJoinLog,
  WorldJoinParseError,
} from './worldJoinParser';
// 個別のパーサー関数も再エクスポート
export { extractWorldJoinInfoFromLogs } from './worldJoinParser';
export type { VRChatWorldLeaveLog } from './worldLeaveParser';
export {
  extractWorldLeaveInfoFromLog,
  inferWorldLeaveEvents,
} from './worldLeaveParser';
