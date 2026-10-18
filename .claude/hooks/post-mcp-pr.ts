#!/usr/bin/env bun
/**
 * PostToolUse(mcp__*__[github_]create_pull_request、
 *   Cursor では MCP:[github_]create_pull_request): PR 作成後、次の PR 用にレビュー記録をリセットする。
 *
 * Bash 経路の post-bash-pr.ts は `gh pr view` で実際に PR が存在するかを確認してから
 * リセットする（終了コードは `|| true` 等で上書きできるため信用しない）。MCP 経路は
 * `gh` を使わないので同じ確認はできない。`tool_response` に is_error 系のキーがあれば
 * それを見て明らかな失敗はスキップするが、MCP ツール呼び出しの失敗表現の正確な形式は
 * 未確認のため、無い場合はリセットする（PreToolUse が既に収束を確認した呼び出しだけを
 * ここまで通すため）。呼び出しが実際には失敗していた場合、次の PR 作成でもう一度
 * レビューを求めることになるだけで、安全側に倒れる（レビューなしで PR 作成を許すことには
 * ならない）。
 */
import { join } from 'node:path';
import type { HookInput } from './hook-utils.ts';
import { projectDirectory, workingTree } from './hook-utils.ts';
import { prCreateTarget } from './pr-create-target.ts';

const text = await Bun.stdin.text();
let input: HookInput;
try {
  input = JSON.parse(text);
} catch {
  process.exit(0);
}
try {
  prCreateTarget(input.tool_input);
} catch {
  process.exit(0);
}
if (input.tool_response?.is_error || input.tool_response?.isError) process.exit(0);

const tree = await workingTree(input);
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
