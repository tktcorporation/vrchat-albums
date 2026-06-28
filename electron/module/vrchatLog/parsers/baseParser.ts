import * as datefns from 'date-fns';

import type { VRChatLogLine } from '../model';

/**
 * VRChatログの基本的なパース機能を提供
 */

/**
 * VRChat ログ行の先頭に現れる日時 (`YYYY.MM.DD HH:mm:ss`) を取り出す正規表現。
 *
 * グループ1 = 日付 (`YYYY.MM.DD`)、グループ2 = 時刻 (`HH:mm:ss`) で、
 * そのまま {@link parseLogDateTime} に渡せる。各パーサーで同じ日時パターンを
 * 個別定義していたものを単一ソース化したもの。
 */
export const LOG_DATE_TIME_REGEX = /(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2})/;

/**
 * 行頭固定版の {@link LOG_DATE_TIME_REGEX}。
 *
 * filterLogLinesByDate はログ行の先頭日時のみを対象にするため `^` 固定で照合する。
 * パターンは `LOG_DATE_TIME_REGEX.source` から派生させ、フィルタとパーサーで
 * 日時定義がずれないようにする (SSOT)。
 */
const LOG_DATE_TIME_ANCHORED_REGEX = new RegExp(
  `^${LOG_DATE_TIME_REGEX.source}`,
);

/**
 * ログ行から日付と時刻を抽出してDateオブジェクトに変換
 *
 * VRChat ログの日時解釈はこの関数に集約する。日時フォーマット文字列
 * (`yyyy-MM-dd HH:mm:ss`) をここ一箇所だけに置くことで、各パーサーが
 * 独自にフォーマットを持ってずれる事態を防ぐ (SSOT)。
 *
 * @param dateStr YYYY.MM.DD形式の日付文字列
 * @param timeStr HH:mm:ss形式の時刻文字列
 * @returns パースされたDateオブジェクト
 */
export const parseLogDateTime = (dateStr: string, timeStr: string): Date => {
  const formattedDate = dateStr.replaceAll('.', '-');
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
    const dateTimeMatch = LOG_DATE_TIME_ANCHORED_REGEX.exec(logLine);
    if (!dateTimeMatch) {
      return false;
    }

    const [, date, time] = dateTimeMatch;
    const logDate = parseLogDateTime(date, time);

    if (!datefns.isValid(logDate)) {
      return false;
    }

    return (
      datefns.isAfter(logDate, startDate) || datefns.isEqual(logDate, startDate)
    );
  });
};
