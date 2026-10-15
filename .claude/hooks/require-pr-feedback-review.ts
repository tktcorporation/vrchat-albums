#!/usr/bin/env bun
/** 外部レビュー指摘を受けた PR の修正を、ローカルのレビューループが収束する前に push させない。 */
import { $ } from 'bun';
import { readInput } from './hook-utils.ts';
import { refreshFeedback } from './pr-feedback-observation.ts';
import {
  judgeExternalPush,
  markFeedbackReviewed,
} from './pr-feedback-policy.ts';
import { reviewTargetSha } from './review-count.ts';
import { workingTree } from './hook-utils.ts';

function block(message: string): never {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

const input = await readInput();
const feedback = await refreshFeedback(input);
if (feedback.kind === 'no_pr') process.exit(0);
if (feedback.kind === 'unavailable') block(feedback.reason);
const { history, rounds, path: historyPath, remoteHead } = feedback;
if (history.heads.length === 0) process.exit(0);
const sha = await reviewTargetSha(input);
const reviewedSha = rounds.at(-1)?.sha;
const published = !!reviewedSha && !!remoteHead &&
  (await $`git merge-base --is-ancestor ${reviewedSha} ${remoteHead}`
    .cwd(await workingTree(input)).quiet().nothrow()).exitCode === 0;
const verdict = judgeExternalPush(history, rounds, sha, published);
if (verdict === 'consult_user') {
  block(
    `この PR では異なる HEAD への外部レビュー指摘が ${history.heads.length} 回続いています。修正と push を止め、各回の指摘とローカルレビューで見逃した理由を根本原因ごとに整理し、なぜレビューが続くのか診断してください。設計・要件・レビュー手順を変える具体案を効果と影響で比較し、推奨案を添えてユーザーに採る方針を尋ねてください。レビューを続けるかだけの質問では足りません。答えを得た後に bun .claude/hooks/record-pr-feedback.ts asked "<診断とユーザーが選んだ方針>" で記録してください。`,
  );
}
if (verdict === 'review_locally') {
  block(
    '外部レビュー指摘の観測後に 2 ラウンドのセルフレビューが現在の HEAD で収束していません。.claude/skills/pr-review-loop/SKILL.md の手順で差分全体をレビューし、bun .claude/hooks/record-pr-review.ts で記録してから push してください。',
  );
}
if (history.reviewedCommentCount < history.seenComments.length) {
  await Bun.write(historyPath, JSON.stringify(markFeedbackReviewed(history)));
}
