#!/usr/bin/env bun
/**
 * 外部レビュー指摘を受けた PR の修正を、ローカルのレビューループが収束する前に push させない。
 * GitHub を確かめられないときは止めず、警告を additionalContext で返す（stderr は exit 0 だと
 * エージェントへ届かないため）。
 */
import { readInput, resolveTarget } from './hook-utils.ts';
import { evaluatePushGate } from './pr-push-gate.ts';

// pre-bash-guard.ts が `git -C` や cd・サブシェルを解いた push 先を cwd に入れて起動する。
const target = await resolveTarget(await readInput());
const verdict = await evaluatePushGate(target, { dryRun: false });
if (verdict.kind === 'block') {
  console.error(`BLOCKED: ${verdict.message}`);
  process.exit(2);
}
if (verdict.basis === 'unchecked')
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `WARNING: ${verdict.warning}`,
      },
    }),
  );
