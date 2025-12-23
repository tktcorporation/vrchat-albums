import { match } from 'ts-pattern';
import type { VRChatLogLine } from '../model';
import { parseLogDateTime } from './baseParser';

export interface VRChatWorldLeaveLog {
  logType: 'worldLeave';
  leaveDate: Date;
  reason?: 'userAction' | 'applicationQuit' | 'disconnect' | 'unknown';
}

/**
 * ワールド退出ログのパース機能
 *
 * VRChatではワールド退出の明示的なログが少ないため、
 * 間接的な手がかりを使用してワールド退出を検出する
 */

/**
 * ログエントリーからワールド退出情報を抽出
 * @param logEntry ログ行
 * @returns ワールド退出情報、または抽出できない場合null
 */
export const extractWorldLeaveInfoFromLog = (
  logEntry: VRChatLogLine,
): VRChatWorldLeaveLog | null => {
  // アプリケーション終了パターン
  const appQuitPatterns = [/VRCApplication: HandleApplicationQuit/];

  // 接続切断パターン
  const disconnectPatterns = [
    /Lost connection/,
    /Disconnected/,
    /Network error/,
    /Connection timeout/,
  ];

  // 手動退出パターン（推測）
  // TODO: 実際のVRChatログパターンを調査して追加
  const userActionPatterns: RegExp[] = [];

  // 日時を抽出
  const dateTimeRegex = /(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2})/;
  const dateTimeMatch = logEntry.match(dateTimeRegex);

  if (!dateTimeMatch) {
    return null;
  }

  const date = dateTimeMatch[1];
  const time = dateTimeMatch[2];
  const leaveDate = parseLogDateTime(date, time);

  // パターンマッチング
  const patterns = [
    { patterns: appQuitPatterns, reason: 'applicationQuit' as const },
    { patterns: disconnectPatterns, reason: 'disconnect' as const },
    { patterns: userActionPatterns, reason: 'userAction' as const },
  ];

  const matchedPattern = patterns.find(({ patterns: patternList }) =>
    patternList.some((pattern) => pattern.test(logEntry)),
  );

  return match(matchedPattern)
    .with(undefined, () => null)
    .otherwise((matched) => ({
      logType: 'worldLeave' as const,
      leaveDate,
      reason: matched.reason,
    }));
};

/**
 * ワールド退出を推測するためのヒューリスティック
 *
 * 明示的な退出ログがない場合、以下の手がかりから退出を推測：
 * 1. 次のワールド参加ログが見つかった場合、その直前で退出と判定
 * 2. ログファイルの最後に到達した場合、セッション終了と判定
 *
 * @param logLines すべてのログ行
 * @param worldJoinIndices ワールド参加ログのインデックス配列
 * @returns 推測されたワールド退出ログの配列
 */
export const inferWorldLeaveEvents = (
  logLines: VRChatLogLine[],
  worldJoinIndices: number[],
): VRChatWorldLeaveLog[] => {
  const inferredLeaves: VRChatWorldLeaveLog[] = [];

  for (let i = 0; i < worldJoinIndices.length; i++) {
    const nextJoinIndex = worldJoinIndices[i + 1];

    const { leaveIndex, reason } = match(nextJoinIndex !== undefined)
      .with(false, () => ({
        // 最後のワールド参加の場合、ログファイルの最後で退出と判定
        leaveIndex: logLines.length - 1,
        reason: 'applicationQuit' as const, // ログファイルが終了しているため
      }))
      .with(true, () => ({
        // 次のワールド参加がある場合、その直前で退出と判定
        leaveIndex: nextJoinIndex - 1,
        reason: 'userAction' as const,
      }))
      .exhaustive();

    // 退出時刻を推定
    const leaveLogEntry = logLines[leaveIndex];
    if (leaveLogEntry) {
      const dateTimeRegex = /(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2})/;
      const dateTimeMatch = leaveLogEntry.match(dateTimeRegex);

      if (dateTimeMatch) {
        const date = dateTimeMatch[1];
        const time = dateTimeMatch[2];
        const leaveDate = parseLogDateTime(date, time);

        inferredLeaves.push({
          logType: 'worldLeave',
          leaveDate,
          reason,
        });
      }
    }
  }

  return inferredLeaves;
};
