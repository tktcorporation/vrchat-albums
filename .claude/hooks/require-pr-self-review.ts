#!/usr/bin/env bun
import { readInput } from './hook-utils.ts';
import { readRounds, reviewTargetSha } from './review-count.ts';
import { MIN_ROUNDS, convergenceReason, judgeConvergence } from './review-policy.ts';
const input = await readInput();
const [rounds, currentSha] = await Promise.all([readRounds(input), reviewTargetSha(input)]);
const convergence = judgeConvergence(rounds, currentSha);
if (convergence.kind !== 'converged') {
  const history =
    rounds.length === 0
      ? '記録なし'
      : `指摘件数の推移: ${rounds.map((r) => (r.reviewer === 'codex' ? `${r.count}(codex)` : r.count)).join(' → ')}`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `PR作成をブロックしました。このブランチのレビューループが収束していません（${convergenceReason(convergence)}。${history}）。.claude/skills/pr-review-loop/SKILL.md の手順でレビューと修正を繰り返し、ラウンドごとに bun .claude/hooks/record-pr-review.ts <指摘件数> [codex] [accepted] で記録してください。${MIN_ROUNDS} ラウンド以上・最後のラウンドが codex review で現在の HEAD に対して 0 件（またはユーザー受け入れの accepted）、で通ります。`,
      },
    }),
  );
}
