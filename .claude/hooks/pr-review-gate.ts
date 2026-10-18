/**
 * PR 作成をブロックする各 PreToolUse フック（Bash の `gh pr create` 用・GitHub MCP の
 * `mcp__github__create_pull_request` 用）が共有する、収束判定から deny 出力までのロジック。
 * 経路ごとに違うのは「対象ブランチの特定方法」だけで、収束条件と deny の文言は 1 箇所で持つ。
 */
import { MIN_ROUNDS, convergenceReason, judgeConvergence } from './review-policy.ts';
import type { Round } from './review-policy.ts';

/** レビューループが収束していなければ deny 理由の文字列、収束していれば null。 */
export function convergenceDenyReason(
  rounds: Round[],
  currentSha: string,
  prefix: string,
): string | null {
  const convergence = judgeConvergence(rounds, currentSha);
  if (convergence.kind === 'converged') return null;
  const history =
    rounds.length === 0
      ? '記録なし'
      : `指摘件数の推移: ${rounds.map((round) => (round.reviewer === 'codex' ? `${round.count}(codex)` : round.count)).join(' → ')}`;
  return (
    `${prefix}このブランチのレビューループが収束していません（${convergenceReason(convergence)}。${history}）。` +
    '.claude/skills/pr-review-loop/SKILL.md の手順でレビューと修正を繰り返し、ラウンドごとに ' +
    'bun .claude/hooks/record-pr-review.ts <指摘件数> [codex] [accepted] で記録してください。' +
    `${MIN_ROUNDS} ラウンド以上・最後のラウンドが codex review で現在の HEAD に対して 0 件` +
    '（またはユーザー受け入れの accepted）、で通ります。'
  );
}

/** PreToolUse の deny 応答（Claude Code の hookSpecificOutput プロトコル）。 */
export function denyJson(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}
