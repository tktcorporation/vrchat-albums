#!/usr/bin/env bun
/** 3 回目以降の外部指摘について、ユーザーの回答を得た事実を記録する。 */
import { readInput } from './hook-utils.ts';
import { refreshFeedback } from './pr-feedback-observation.ts';
import { EXTERNAL_REVIEW_LIMIT, acknowledgeFeedback } from './pr-feedback-policy.ts';
import { MIN_NOTE_LENGTH, normalizeNote } from './review-policy.ts';

const [decision, ...words] = process.argv.slice(2);
const note = normalizeNote(words.join(' '));
if (decision !== 'asked' || note.length < MIN_NOTE_LENGTH) {
  console.error(`使い方: bun .claude/hooks/record-pr-feedback.ts asked "<レビューが続く原因とユーザーが選んだ方針（${MIN_NOTE_LENGTH}文字以上）>"`);
  process.exit(1);
}
const input = await readInput();
const feedback = await refreshFeedback(input);
if (feedback.kind !== 'found') {
  console.error(feedback.kind === 'no_pr' ? '現在のブランチに開いている PR が見つかりません。' : feedback.reason);
  process.exit(1);
}
const { history, rounds, path } = feedback;
if (history.heads.length < EXTERNAL_REVIEW_LIMIT) {
  console.error('外部レビューが相談を要する回数に達していません。');
  process.exit(1);
}
await Bun.write(path, JSON.stringify(acknowledgeFeedback(history, note, rounds.length)));
console.log(`PR #${history.pr} の外部レビュー ${history.heads.length} 回についてユーザー判断を記録しました。`);
