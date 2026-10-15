/**
 * doc の鮮度判定。「最終コミットからの経過日数」を唯一の鮮度指標にする。
 *
 * なぜ git のコミット日時か: doc 側に「最終更新日」を書かせると、それ自体が
 * 更新漏れでズレる（更新日の SSOT は git 履歴）。ファイルの mtime も checkout や
 * テンプレート同期で書き換わるため使えない。
 *
 * 判定はここに純関数として閉じ、git の実行は git.ts が持つ。
 */

import { DateTime } from 'luxon';
import type { Lifecycle } from './config.ts';
import type { DocMeta } from './frontmatter.ts';

export type FreshnessVerdict =
  /** 鮮度チェックの対象外（generated） */
  | { kind: 'exempt' }
  /** shallow clone で git 履歴が truncate されており、経過日数を判定できない */
  | { kind: 'history-unavailable' }
  /** git 履歴に無い、またはローカルで編集中（見直しの最中は鮮度を問わない） */
  | { kind: 'uncommitted' }
  | { kind: 'fresh'; ageDays: number; limitDays: number }
  /** review-by による猶予期間中 */
  | { kind: 'in-grace'; until: string; reason: string; ageDays: number | null }
  /** review-by の期限切れ。宣言した見直し期限を過ぎている */
  | { kind: 'grace-expired'; until: string; ageDays: number | null }
  | { kind: 'stale'; ageDays: number; limitDays: number };

export interface FreshnessInput {
  lifecycle: Lifecycle;
  /** null は「git 履歴に存在しない」= 未コミット */
  lastCommittedAt: DateTime | null;
  meta: DocMeta;
  /** null は鮮度チェックの対象外 */
  limitDays: number | null;
  now: DateTime;
  /**
   * git 履歴が完全に読めるか。shallow clone では最終コミット日時が実際より
   * 新しく見えるため、誤って fresh と判定しないよう鮮度判定自体を止める。
   */
  historyAvailable: boolean;
}

/**
 * `git log --format` で日時行とパス行を区別するための区切り文字。
 * ファイルパスに現れ得ない制御文字を使う（改行区切りだけではパス行と区別できない）。
 */
export const GIT_LOG_COMMIT_MARKER = String.fromCharCode(1);

/** 日付境界で切った経過日数。同日なら 0 */
function ageInDays(lastCommittedAt: DateTime, now: DateTime): number {
  const elapsed = now.startOf('day').diff(lastCommittedAt.startOf('day'), 'days').days;
  return Math.max(0, Math.floor(elapsed));
}

export function judgeFreshness(input: FreshnessInput): FreshnessVerdict {
  const { lastCommittedAt, meta, limitDays, now } = input;

  if (limitDays === null) return { kind: 'exempt' };

  // 履歴が読めない環境では経過日数を出せない。猶予判定はこの値を使わないので
  // null のまま進める。
  const ageDays =
    !input.historyAvailable || lastCommittedAt === null ? null : ageInDays(lastCommittedAt, now);

  // review-by は「この日まで見直しを保留する」明示的な意思表示なので、
  // パス由来の閾値より優先する。期限を過ぎたら閾値に戻すのではなく期限切れとして
  // 報告する — 宣言した期日を守らせるほうが、閾値に埋もれるより行動に繋がる。
  //
  // 履歴の有無より先に判定するのは、期限の超過が now だけで決まるため。
  // shallow clone で鮮度チェックを止めても、宣言した見直し期限は検知できる。
  if (meta.reviewBy !== null) {
    const until = DateTime.fromISO(meta.reviewBy, { zone: 'utc' });
    if (until.endOf('day') >= now) {
      return {
        kind: 'in-grace',
        until: meta.reviewBy,
        reason: meta.reviewReason ?? '',
        ageDays,
      };
    }
    return { kind: 'grace-expired', until: meta.reviewBy, ageDays };
  }

  if (!input.historyAvailable) return { kind: 'history-unavailable' };
  if (ageDays === null) return { kind: 'uncommitted' };
  if (ageDays > limitDays) return { kind: 'stale', ageDays, limitDays };
  return { kind: 'fresh', ageDays, limitDays };
}

/**
 * `git log --format=%x01%cI --name-only` の出力から、パスごとの最終コミット日時を取り出す。
 *
 * git log は新しい順に出力するため、各パスの初出がその最終更新になる。
 * コミット単位で 1 回の spawn に収めるのは、doc 1 件ずつ git log を呼ぶと
 * doc が増えたときに線形に遅くなるため。
 */
export function parseGitLogFileDates(output: string): Map<string, string> {
  const dates = new Map<string, string>();
  let currentCommittedAt: string | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith(GIT_LOG_COMMIT_MARKER)) {
      currentCommittedAt = line.slice(GIT_LOG_COMMIT_MARKER.length).trim();
      continue;
    }
    const path = line.trim();
    if (path.length === 0 || currentCommittedAt === null) continue;
    if (!dates.has(path)) dates.set(path, currentCommittedAt);
  }

  return dates;
}
