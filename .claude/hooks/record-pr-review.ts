#!/usr/bin/env bun
import { $ } from 'bun';
import { readEntries, reviewTargetSha, writeEntries } from './review-count.ts';
import {
  ASKED,
  CHECKPOINT_DECISIONS,
  CHECKPOINT_INTERVAL,
  LONG_REVIEW_ROUNDS,
  MIN_NOTE_LENGTH,
  ROUND_FLAGS,
  assertNever,
  convergenceReason,
  isRoundFlag,
  judgeCheckpoint,
  judgeRound,
  roundFromFlags,
  roundsOf,
} from './review-policy.ts';
import type {
  CheckpointReason,
  CheckpointDecision,
  CheckpointRejection,
  DueState,
} from './review-policy.ts';

const usage =
  '使い方:\n' +
  `  ラウンドの記録: bun .claude/hooks/record-pr-review.ts <このラウンドの指摘件数> [${ROUND_FLAGS.join('] [')}]\n` +
  `  振り返りの記録: bun .claude/hooks/record-pr-review.ts checkpoint <${CHECKPOINT_DECISIONS.join('|')}> "<診断メモ>"\n` +
  '指摘に対応し終えたラウンドだけを記録する。指摘 0 件のラウンドは 0 を渡す。\n' +
  'codex review でレビューしたラウンドは codex を渡す（自己申告であり、hook は実行の\n' +
  '有無を検証しない。虚偽の記録は .claude/rules/agent-work-discipline.md のツール結果の\n' +
  '捏造にあたる）。\n' +
  'ユーザーが残る指摘を受け入れて途中収束させる場合は accepted も渡す（このときは\n' +
  '実際の指摘件数をそのまま記録し、0 だと偽らない）。\n' +
  '対象はレビューを終えて修正をコミットした後の HEAD。未コミットの変更が残る状態で記録しない。\n' +
  `${CHECKPOINT_INTERVAL} ラウンドごとに振り返りが必要になり、済ませるまで、収束しないラウンドを記録できない。\n` +
  `ラウンドが ${LONG_REVIEW_ROUNDS} に達したら、件数の傾向に関係なく、振り返りでユーザーへの確認（${ASKED}）が必須になる。`;

const noteGuide =
  `診断メモ（${MIN_NOTE_LENGTH} 文字以上）には、指摘をどう分類したか、レビューが続く原因は何か、` +
  '設計・要件・進め方を変える必要があるかを書いてください。件数が減っていても、中身の確認は省略できません。';
const consultationGuide =
  '全ラウンドの指摘を原因ごとにまとめ、なぜレビューが続くのか、局所修正で収束しなかった仕組みを診断してください。' +
  '設計・要件・進め方を変える案を効果と影響で比較し、推奨案を添えてユーザーに採る方針を尋ねてください。' +
  'レビューを続けるかだけの質問では足りません。';
const trendText = (counts: number[]): string => counts.join(' → ');

function checkpointReasonText(reason: CheckpointReason, counts: number[]): string {
  switch (reason.kind) {
    case 'stalled':
      return `指摘件数が停滞している（${trendText(counts)}）`;
    case 'long':
      return `レビューが ${reason.totalRounds} ラウンドに及んでいる`;
    default:
      return assertNever(reason);
  }
}

function rejectionText(rejection: CheckpointRejection): string {
  switch (rejection.kind) {
    case 'not_due':
      return `振り返りの時期ではありません（直近の振り返り以降 ${rejection.counts.length} ラウンド。${CHECKPOINT_INTERVAL} ラウンドで必要になります）。`;
    case 'must_ask':
      return `${checkpointReasonText(rejection.reason, rejection.counts)}ので、${consultationGuide} 答えを得てから ${ASKED} で記録してください。`;
    case 'note_too_short':
      return `診断メモが短すぎます。${noteGuide}`;
    default:
      return assertNever(rejection);
  }
}

function blockedText(state: DueState, rerun: string): string {
  let decide: string;
  if (state.reason === null) {
    decide =
      '2. 方針を変えるか、変えずに続けるかを決めて、\n' +
      `   bun .claude/hooks/record-pr-review.ts checkpoint <${CHECKPOINT_DECISIONS.filter((decision) => decision !== ASKED).join('|')}> "<診断メモ>"\n`;
  } else {
    decide =
      `2. ${checkpointReasonText(state.reason, state.counts)}ので、${consultationGuide} 答えを得てから、\n` +
      `   bun .claude/hooks/record-pr-review.ts checkpoint ${ASKED} "<診断メモ>"\n`;
  }
  return (
    `振り返りが必要です（指摘件数の推移: ${trendText(state.counts)}）。このラウンドの記録は保留しました。\n` +
    '次の順に進めてください。\n' +
    '1. .claude/skills/pr-review-loop/SKILL.md の「振り返り」で、指摘の中身を分類し、共通の構造的原因と、より良い解決策がないかを確認する\n' +
    `${decide}   を実行する。${noteGuide}\n` +
    `3. 保留したラウンドを、もう一度 ${rerun} で記録する`
  );
}

const [countArg, ...flagArgs] = process.argv.slice(2);

if (countArg === 'checkpoint') {
  const [decision, ...noteWords] = flagArgs;
  if (!CHECKPOINT_DECISIONS.includes(decision as CheckpointDecision)) {
    console.error(usage);
    process.exit(1);
  }
  const verdict = judgeCheckpoint(
    await readEntries(),
    decision as CheckpointDecision,
    noteWords.join(' '),
    await reviewTargetSha(),
  );
  if (verdict.kind === 'reject') {
    console.error(rejectionText(verdict.rejection));
    process.exit(1);
  }
  await writeEntries(verdict.entries);
  console.log(`振り返りを記録（${decision}）。次のラウンドから記録できます。`);
  process.exit(0);
}

if (countArg === undefined || !/^\d+$/.test(countArg) || !flagArgs.every(isRoundFlag)) {
  console.error(usage);
  process.exit(1);
}
// 追跡ファイルの変更だけを見る。レビュー対象は `git diff origin/<default-branch>...HEAD` で、
// 未追跡ファイルはそこに含まれないため、無関係な作業ファイルの存在では止めない。
const status = await $`git status --porcelain --untracked-files=no`.quiet().nothrow();
if (status.exitCode === 0 && status.text().trim()) {
  console.error(
    '追跡ファイルに未コミットの変更があります。レビュー対象は「レビューを終えて修正をコミットした後の HEAD」なので、先にコミットしてから記録してください。',
  );
  process.exit(1);
}
const round = roundFromFlags(Number(countArg), await reviewTargetSha(), flagArgs);
const verdict = judgeRound(await readEntries(), round);
if (verdict.kind === 'blocked') {
  const rerun = `bun .claude/hooks/record-pr-review.ts ${[countArg, ...flagArgs].join(' ')}`;
  console.error(blockedText(verdict.state, rerun));
  process.exit(1);
}
await writeEntries(verdict.entries);
const roundCount = roundsOf(verdict.entries).length;
const converged = verdict.convergence.kind === 'converged';
const state =
  verdict.convergence.kind === 'converged'
    ? 'PR 作成前レビューは収束。既存 PR の外部指摘後は、指摘の観測以降に 2 ラウンドのレビューが必要'
    : `未収束（${convergenceReason(verdict.convergence)}）`;
const flagText = flagArgs.map((flag) => `、${flag}`).join('');
console.log(`ラウンド ${roundCount} を記録（指摘 ${countArg} 件${flagText}）。${state}。`);
if (verdict.next.status === 'due' && !converged) {
  const { counts, reason } = verdict.next;
  console.log(
    `次のラウンドに進む前に振り返りが必要です（指摘件数の推移: ${trendText(counts)}）。件数が減っていても、指摘の中身を分類して構造的原因を確認します。` +
      (reason === null
        ? ''
        : `${checkpointReasonText(reason, counts)}ので、${consultationGuide}`) +
      '手順は .claude/skills/pr-review-loop/SKILL.md の「振り返り」にあります。',
  );
}
