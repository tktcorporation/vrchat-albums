import { match } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import type { VRChatLogLine } from '../model';
import {
  extractPlayerJoinInfoFromLog,
  extractPlayerLeaveInfoFromLog,
  type VRChatPlayerJoinLog,
  type VRChatPlayerLeaveLog,
} from './playerActionParser';
import {
  extractWorldJoinInfoFromLogs,
  type VRChatWorldJoinLog,
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
    if (l.value.includes('Joining wrld_')) {
      const info = extractWorldJoinInfoFromLogs(logLines, index);
      if (info) {
        logInfos.push(info);
        worldJoinIndices.push(index);
      }
    }

    // ワールド退出ログ（明示的なパターン）
    const leaveInfo = extractWorldLeaveInfoFromLog(l);
    if (leaveInfo) {
      logInfos.push(leaveInfo);
    }

    // プレイヤー参加ログ
    if (l.value.includes('[Behaviour] OnPlayerJoined')) {
      const result = extractPlayerJoinInfoFromLog(l);

      if (result.isOk()) {
        logInfos.push(result.value);
      } else {
        // ログ行からプレイヤー名とIDを抽出（デバッグ用）
        const playerNameMatch = l.value.match(
          /OnPlayerJoined (.+?)(?:\s+\((usr_[^)]+)\))?$/,
        );
        const playerName = playerNameMatch
          ? playerNameMatch[1]
          : 'Unknown player';
        const playerIdMatch = l.value.match(/\((usr_[^)]+)\)/);
        const playerId = playerIdMatch
          ? playerIdMatch[1]
          : 'No player ID found';

        // エラータイプに応じた詳細なエラーメッセージを生成
        const errorMessage = match(result.error)
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
          line: l.value,
          error: errorMessage,
          type: 'player_join',
        });

        // エラーログとして記録（自動的にSentryに送信される）
        logger.error({
          message: new Error(`Player join parse error: ${errorMessage}`),
          details: {
            logLine: l.value,
            playerName,
            playerId,
            errorType: result.error,
          },
        });
      }
    }

    // プレイヤー退出ログ（OnPlayerLeftRoomは除外）
    if (
      l.value.includes('OnPlayerLeft') &&
      !l.value.includes('OnPlayerLeftRoom')
    ) {
      const result = extractPlayerLeaveInfoFromLog(l);

      if (result.isOk()) {
        logInfos.push(result.value);
      } else {
        // ログ行からプレイヤー名とIDを抽出（デバッグ用）
        const playerNameMatch = l.value.match(
          /OnPlayerLeft (.+?)(?:\s+\((usr_[^)]+)\))?$/,
        );
        const playerName = playerNameMatch
          ? playerNameMatch[1]
          : 'Unknown player';
        const playerIdMatch = l.value.match(/\((usr_[^)]+)\)/);
        const playerId = playerIdMatch
          ? playerIdMatch[1]
          : 'No player ID found';

        // エラータイプに応じた詳細なエラーメッセージを生成
        const errorMessage = match(result.error)
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
          line: l.value,
          error: errorMessage,
          type: 'player_leave',
        });

        // エラーログとして記録（自動的にSentryに送信される）
        logger.error({
          message: new Error(`Player leave parse error: ${errorMessage}`),
          details: {
            logLine: l.value,
            playerName,
            playerId,
            errorType: result.error,
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
export type { VRChatWorldJoinLog } from './worldJoinParser';
// 個別のパーサー関数も再エクスポート
export { extractWorldJoinInfoFromLogs } from './worldJoinParser';
export type { VRChatWorldLeaveLog } from './worldLeaveParser';
export {
  extractWorldLeaveInfoFromLog,
  inferWorldLeaveEvents,
} from './worldLeaveParser';
