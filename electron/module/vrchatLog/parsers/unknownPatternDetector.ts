import { logger } from '../../../lib/logger';
import {
  DETECTION_BROAD_PATTERNS,
  FILTER_PATTERNS,
  KNOWN_NOISE_PATTERNS,
  LOG_PATTERNS,
} from '../constants/logPatterns';
import type { VRChatLogLine } from '../model';

/**
 * パーサーが処理対象として認識するすべてのパターン + 処理不要な既知ノイズ。
 * FILTER_PATTERNS に加え、補助的に使われるパターン（ワールド名抽出用等）と、
 * VRChat が正常に出力するが処理不要なパターンを含む。
 *
 * この一覧に含まれる文字列を持つ行は「既知」として扱い、未知パターン検知の対象外とする。
 */
const KNOWN_PATTERNS: readonly string[] = [
  ...FILTER_PATTERNS,
  LOG_PATTERNS.WORLD_NAME,
  ...KNOWN_NOISE_PATTERNS,
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
    if (!matchesBroad) {
      continue;
    }

    // 2. 既知パターンのいずれかにマッチするなら既知 → スキップ
    const matchesKnown = KNOWN_PATTERNS.some((p) => line.includes(p));
    if (matchesKnown) {
      continue;
    }

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
 * 動作名 = [Behaviour] 直後の、空白で区切られた先頭トークン。
 *
 * PII（プレイヤー名やID等）がフォールバックで Sentry に送信されることを防ぐため、
 * regex にマッチしない場合は固定のプレースホルダーを返す。
 *
 * 例:
 *   "[Behaviour] OnPlayerJoined Alice" → "[Behaviour] OnPlayerJoined"
 *   "[Behaviour] Joining wrld_xxx:instance" → "[Behaviour] Joining"
 *   "[Behaviour] Something completely new here" → "[Behaviour] Something"
 *   "unparseable line" → "[Behaviour] <unparsed>"
 */
export const extractPatternSkeleton = (line: string): string => {
  const matched = line.match(/\[Behaviour\]\s+([^\s]+)/);
  if (!matched) {
    return '[Behaviour] <unparsed>';
  }
  return `[Behaviour] ${matched[1]}`;
};

/**
 * 同期サイクルをまたいで既に報告済みの骨格パターンを記録する。
 * 同一プロセス内で同じパターンを繰り返し Sentry に送信することを防ぐ。
 *
 * アプリ再起動でリセットされるため、新しいセッションでは再検出される。
 */
const reportedSkeletons = new Set<string>();

/**
 * プロセスあたりの Sentry error 送信上限。
 *
 * 未知パターンは VRChat のアップデートで一度に複数追加されることがあるが、
 * 同一プロセス内でそれ以上送信しても新しい情報は得られない。
 * 上限到達後は warn（ローカルログのみ）に降格して Sentry クオータを保護する。
 *
 * 背景: v0.27.0 で 9,619 件/14日の Sentry イベントが発生した（VRCHAT-PHOTO-ELECTRON-5C）。
 */
const MAX_SENTRY_REPORTS_PER_PROCESS = 3;
let sentryReportCount = 0;

/**
 * 未知パターンを検出し、結果をロガーに記録する。
 *
 * 送信ポリシー:
 * 1. 同一骨格パターンはプロセス内で1回のみ報告（reportedSkeletons で重複排除）
 * 2. Sentry への error 送信はプロセスあたり最大 MAX_SENTRY_REPORTS_PER_PROCESS 回
 * 3. 上限到達後は warn に降格（ローカルログには残るが Sentry には送らない）
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

  // 未報告のパターンのみ抽出
  const newPatterns = summary.uniquePatterns.filter(
    (p) => !reportedSkeletons.has(p),
  );

  if (newPatterns.length === 0) {
    return;
  }

  // 報告済みとして記録
  for (const p of newPatterns) {
    reportedSkeletons.add(p);
  }

  const message =
    `Detected ${summary.totalCount} unknown log pattern(s) matching broad filter. ` +
    `${newPatterns.length} new unique pattern(s) found. ` +
    'VRChat may have added new log events.';

  // Sentry 送信上限チェック: 上限内なら error（Sentry送信）、超過なら warn（ローカルのみ）
  if (sentryReportCount < MAX_SENTRY_REPORTS_PER_PROCESS) {
    sentryReportCount++;
    logger.warn(message);
    logger.error({
      message: new Error(
        `Unknown VRChat log patterns detected: ${newPatterns.length} unique pattern(s)`,
      ),
      details: {
        uniquePatterns: newPatterns,
        totalCount: summary.totalCount,
        sentryReportCount,
      },
    });
  } else {
    logger.warn(
      `${message} (Sentry report suppressed: ${sentryReportCount}/${MAX_SENTRY_REPORTS_PER_PROCESS} reports sent this session)`,
    );
  }
};

/** テスト用: reportedSkeletons と sentryReportCount をリセットする */
export const _resetReportedSkeletons = (): void => {
  reportedSkeletons.clear();
  sentryReportCount = 0;
};
