import * as datefns from 'date-fns';
import type { VRChatLogLine } from '../model';

/**
 * VRChatログの基本的なパース機能を提供
 */

/**
 * ログ行から日付と時刻を抽出してDateオブジェクトに変換
 * @param dateStr YYYY.MM.DD形式の日付文字列
 * @param timeStr HH:mm:ss形式の時刻文字列
 * @returns パースされたDateオブジェクト
 */
export const parseLogDateTime = (dateStr: string, timeStr: string): Date => {
  const formattedDate = dateStr.replace(/\./g, '-');
  return datefns.parse(
    `${formattedDate} ${timeStr}`,
    'yyyy-MM-dd HH:mm:ss',
    new Date(),
  );
};

// 注意: ワールドID検証機能はvalueObjectsパターンに移行されました
// VRChatWorldId.isValid() を使用してください

// 注意: プレイヤーID検証機能はvalueObjectsパターンに移行されました
// VRChatPlayerId.isValid() を使用してください

/**
 * ログ行を日付でフィルタリング
 * @param logLines フィルタリング対象のログ行
 * @param startDate この日付以降のログを含む
 * @returns フィルタリングされたログ行
 */
export const filterLogLinesByDate = (
  logLines: VRChatLogLine[],
  startDate: Date,
): VRChatLogLine[] => {
  return logLines.filter((logLine) => {
    const dateTimeMatch = logLine.match(
      /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})/,
    );
    if (!dateTimeMatch) return false;

    const [, year, month, day, hour, minute, second] = dateTimeMatch;
    const logDate = datefns.parse(
      `${year}-${month}-${day} ${hour}:${minute}:${second}`,
      'yyyy-MM-dd HH:mm:ss',
      new Date(),
    );

    if (!datefns.isValid(logDate)) {
      return false;
    }

    return (
      datefns.isAfter(logDate, startDate) || datefns.isEqual(logDate, startDate)
    );
  });
};
