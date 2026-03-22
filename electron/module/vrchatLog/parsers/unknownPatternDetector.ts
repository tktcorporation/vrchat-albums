import { logger } from '../../../lib/logger';
import {
  DETECTION_BROAD_PATTERNS,
  FILTER_PATTERNS,
  LOG_PATTERNS,
} from '../constants/logPatterns';
import type { VRChatLogLine } from '../model';

/**
 * パーサーが処理対象として認識するすべてのパターン。
 * FILTER_PATTERNS に加え、補助的に使われるパターン（ワールド名抽出用等）も含む。
 *
 * この一覧に含まれる文字列を持つ行は「既知」として扱い、未知パターン検知の対象外とする。
 */
const KNOWN_PATTERNS: readonly string[] = [
  ...FILTER_PATTERNS,
  LOG_PATTERNS.WORLD_NAME,
];

/**
 * 未知のログパターン検知モジュール
 *
 * VRChat がログ形式を変更・追加した際に早期検出するための仕組み。
 * 広域フィルタ（例: [Behaviour]）にマッチするが、既知の具体的パターン
 * （FILTER_PATTERNS）にはマッチしない行を「未知パターン」として検出する。
 *
 * パフォーマンス: パース処理とは別パスで動作し、検出結果のサマリのみ記録する。
 * 同一パターンの重複排除により、大量の同種行がログを溢れさせることを防ぐ。
 */

/**
 * 未知パターンの検出結果
 */
export interface UnknownPatternSummary {
  /** 未知パターンの代表的な行（重複排除済み） */
  readonly uniquePatterns: string[];
  /** 未知パターンの総出現数 */
  readonly totalCount: number;
}

/**
 * ログ行の中から、広域フィルタにマッチするが既知パターンにマッチしない行を検出する。
 *
 * ログ行から「パターンの骨格」を抽出して重複排除する。
 * 例: "2024.01.15 12:34:56 Log - [Behaviour] OnSomethingNew player1"
 *   → 骨格: "[Behaviour] OnSomethingNew"
 *
 * @param logLines 検査対象のログ行（広域フィルタ済みでなくてもよい）
 * @returns 未知パターンのサマリ
 */
export const detectUnknownPatterns = (
  logLines: VRChatLogLine[],
): UnknownPatternSummary => {
  const skeletonCounts = new Map<string, number>();

  for (const line of logLines) {
    // 1. 広域フィルタにマッチするか
    const matchesBroad = DETECTION_BROAD_PATTERNS.some((p) => line.includes(p));
    if (!matchesBroad) continue;

    // 2. 既知パターンのいずれかにマッチするなら既知 → スキップ
    const matchesKnown = KNOWN_PATTERNS.some((p) => line.includes(p));
    if (matchesKnown) continue;

    // 3. パターンの骨格を抽出して重複排除
    const skeleton = extractPatternSkeleton(line);
    skeletonCounts.set(skeleton, (skeletonCounts.get(skeleton) ?? 0) + 1);
  }

  let totalCount = 0;
  for (const count of skeletonCounts.values()) {
    totalCount += count;
  }

  return {
    uniquePatterns: [...skeletonCounts.keys()],
    totalCount,
  };
};

/**
 * ログ行から「パターンの骨格」を抽出する。
 *
 * VRChat ログ行の構造:
 *   "2024.01.15 12:34:56 Log - [Behaviour] OnSomethingNew player1 (usr_xxx)"
 *
 * ここから [Behaviour] 以降の「動作名」部分を取り出す。
 * 動作名 = [Behaviour] 直後の、空白で区切られた先頭の単語列（英数字とアンダースコアで構成）。
 *
 * 例:
 *   "[Behaviour] OnPlayerJoined Alice" → "[Behaviour] OnPlayerJoined"
 *   "[Behaviour] Joining wrld_xxx:instance" → "[Behaviour] Joining"
 *   "[Behaviour] Something completely new here" → "[Behaviour] Something"
 */
export const extractPatternSkeleton = (line: string): string => {
  const match = line.match(/\[Behaviour\]\s+(\w+)/);
  if (!match) return line;
  return `[Behaviour] ${match[1]}`;
};

/**
 * 未知パターンを検出し、結果をロガーに記録する。
 * 未知パターンが見つかった場合のみ Sentry に送信する。
 *
 * @param logLines 検査対象のログ行
 */
export const detectAndReportUnknownPatterns = (
  logLines: VRChatLogLine[],
): void => {
  const summary = detectUnknownPatterns(logLines);

  if (summary.totalCount === 0) {
    return;
  }

  logger.warn(
    `Detected ${summary.totalCount} unknown log pattern(s) matching broad filter. ` +
      `${summary.uniquePatterns.length} unique pattern(s) found. ` +
      'VRChat may have added new log events.',
  );

  // Sentry に送信して追跡可能にする
  logger.error({
    message: new Error(
      `Unknown VRChat log patterns detected: ${summary.uniquePatterns.length} unique pattern(s)`,
    ),
    details: {
      uniquePatterns: summary.uniquePatterns,
      totalCount: summary.totalCount,
    },
  });
};
