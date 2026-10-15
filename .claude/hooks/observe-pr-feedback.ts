#!/usr/bin/env bun
/** PR の指摘を読み始めた時点のローカルレビュー回数を記録する。 */
import { readInput } from './hook-utils.ts';
import { refreshFeedback } from './pr-feedback-observation.ts';

const feedback = await refreshFeedback(await readInput());
if (feedback.kind !== 'found') {
  console.error(feedback.kind === 'no_pr' ? '現在のブランチに開いている PR が見つかりません。' : feedback.reason);
  process.exit(1);
}
console.log(`PR #${feedback.history.pr} の外部指摘を観測しました（${feedback.history.heads.length} HEAD）。`);
