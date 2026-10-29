import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchGitHubFeedback } from './pr-feedback-github.ts';
import type { GitHubFeedback } from './pr-feedback-github.ts';
import type { GitHubPort, GitHubUnavailableCause } from './github-port.ts';
import { parseExternalReviewHistory } from './pr-feedback-history.ts';
import { workingTree } from './hook-utils.ts';
import { observeFeedbackBatch } from './pr-feedback-policy.ts';
import { externalReviewFile, readRecordedRounds } from './review-count.ts';
import type { ExternalReviewHistory } from './pr-feedback-policy.ts';
import type { Round } from './review-policy.ts';

/** 指摘を確かめられない理由。GitHub 側の理由に加え、手元の外部レビュー履歴が壊れている場合がある。 */
export type FeedbackUnavailableCause = GitHubUnavailableCause | 'history_broken';

export type ObservedFeedback =
  | { kind: 'no_pr' }
  | { kind: 'unavailable'; cause: FeedbackUnavailableCause; reason: string }
  | {
      kind: 'found';
      history: ExternalReviewHistory;
      rounds: Round[];
      path: string;
      remoteHead: string;
    };

/**
 * GitHub の指摘を同じ境界で履歴へ反映する。指摘を読んだ直後に呼べばレビューの基準線になる。
 * `target` は対象チェックアウト（hook-utils.ts の resolveTarget の結果）。省略するとプロセスの
 * 現在地のチェックアウトを対象にする。`port` は同じチェックアウトを対象にした GitHub の Port で、
 * 呼び出し側が取得済みの PR を使い回すときに渡す。
 */
export async function refreshFeedback(
  target?: { cwd?: string } | null,
  port?: GitHubPort,
): Promise<ObservedFeedback> {
  const tree = await workingTree(target);
  return applyFeedbackObservation(await fetchGitHubFeedback(tree, port), target);
}

/** refreshFeedback と同じ取得と反映を、履歴へ書き込まずに行う。 */
export async function previewFeedback(
  target?: { cwd?: string } | null,
  port?: GitHubPort,
): Promise<ObservedFeedback> {
  const tree = await workingTree(target);
  return applyFeedbackObservation(await fetchGitHubFeedback(tree, port), target, {
    persist: false,
  });
}

/**
 * 検証済みの取得結果だけを履歴へ反映する共有境界。`persist: false` は反映後の履歴を計算するだけで
 * 書き込まない（読み取り専用の診断が、push のゲートと同じ判定を試すときに使う）。
 */
export async function applyFeedbackObservation(
  feedback: GitHubFeedback,
  target?: { cwd?: string } | null,
  options: { persist: boolean } = { persist: true },
): Promise<ObservedFeedback> {
  if (feedback.kind !== 'found') return feedback;
  const path = await externalReviewFile(target);
  const file = Bun.file(path);
  const parsed = parseExternalReviewHistory(
    (await file.exists()) ? await file.text() : '',
    feedback.pr,
  );
  if (parsed.kind === 'invalid') {
    return {
      kind: 'unavailable',
      cause: 'history_broken',
      reason: `外部レビュー履歴（${path}）が壊れています。記録を確認してください。`,
    };
  }
  // 履歴はラウンドの位置を基準線として保存するので、絞り込まない並びで数える。
  const rounds = await readRecordedRounds(target);
  const history = observeFeedbackBatch(parsed.history, feedback.observations, rounds.length);
  if (options.persist && history !== parsed.history) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify(history));
  }
  return { kind: 'found', history, rounds, path, remoteHead: feedback.remoteHead };
}
