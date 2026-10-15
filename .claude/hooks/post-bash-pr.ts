#!/usr/bin/env bun
import { join } from 'node:path';
import {
  hasOpenPrForCurrentBranch,
  isPrCreateCommand,
  projectDirectory,
  workingTree,
} from './hook-utils.ts';
const text = await Bun.stdin.text();
let input: { cwd?: string; tool_input?: { command?: string } };
try {
  input = JSON.parse(text);
} catch {
  process.exit(0);
}
const command = input?.tool_input?.command ?? '';
if (!isPrCreateCommand(command)) process.exit(0);
const tree = await workingTree(input);
// 終了コードは `gh pr create || true` のような形で上書きできるため信用しない。
// 実際にこのブランチへ PR が存在するかを GitHub 側で確認してからリセットする。
if (!(await hasOpenPrForCurrentBranch(tree))) process.exit(0);
const child = Bun.spawn(
  ['bun', join(await projectDirectory(), '.claude/hooks/reset-pr-review-count.ts')],
  {
    cwd: tree,
    env: process.env,
    stdin: new Blob([text]),
    stdout: 'inherit',
    stderr: 'inherit',
  },
);
if ((await child.exited) !== 0) process.exit(1);
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        'PR作成後レビューを実施すること: 初見読者向けの語彙、evergreen comment、technical-writing-styleを確認し、指摘があれば修正する。',
    },
  }),
);
