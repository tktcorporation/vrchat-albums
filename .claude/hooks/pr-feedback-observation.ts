import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchGitHubFeedback } from './pr-feedback-github.ts';
import { parseExternalReviewHistory } from './pr-feedback-history.ts';
import { workingTree } from './hook-utils.ts';
import { observeFeedbackBatch } from './pr-feedback-policy.ts';
import { externalReviewFile, readRounds } from './review-count.ts';
import type { ExternalReviewHistory } from './pr-feedback-policy.ts';
import type { Round } from './review-policy.ts';

export type ObservedFeedback =
  | { kind: 'no_pr' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'found'; history: ExternalReviewHistory; rounds: Round[]; path: string; remoteHead: string };

/** GitHub の指摘を同じ境界で履歴へ反映する。指摘を読んだ直後に呼べばレビューの基準線になる。 */
export async function refreshFeedback(input?: { cwd?: string } | null): Promise<ObservedFeedback> {
  const feedback = await fetchGitHubFeedback(await workingTree(input));
  if (feedback.kind !== 'found') return feedback;
  const path = await externalReviewFile(input);
  const file = Bun.file(path);
  const parsed = parseExternalReviewHistory((await file.exists()) ? await file.text() : '', feedback.pr);
  if (parsed.kind === 'invalid') {
    return { kind: 'unavailable', reason: '外部レビュー履歴が壊れています。記録を確認してください。' };
  }
  const rounds = await readRounds(input);
  const history = observeFeedbackBatch(parsed.history, feedback.observations, rounds.length);
  if (history !== parsed.history) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify(history));
  }
  return { kind: 'found', history, rounds, path, remoteHead: feedback.remoteHead };
}
