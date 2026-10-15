#!/usr/bin/env bun
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { readInput, workingTree } from './hook-utils.ts';
const input = await readInput();
if (!input) process.exit(0);
const root = await workingTree(input);
process.chdir(root);
if (!existsSync('.config/docs-lifecycle.json')) process.exit(0);
const supplied = input.tool_input?.file_path ?? input.tool_input?.path;
if (!supplied || !existsSync(supplied)) process.exit(0);
const file = supplied.startsWith(root) ? relative(root, supplied) : supplied;
if (!/\.mdx?$/.test(file)) process.exit(0);
const config: { scan?: string[] } = await Bun.file('.config/docs-lifecycle.json').json();
const roots = (config.scan ?? []).map((glob) => glob.split('*')[0]);
if (!roots.some((prefix) => file.startsWith(prefix))) process.exit(0);
if ((await $`git ls-files --error-unmatch ${file}`.quiet().nothrow()).exitCode === 0)
  process.exit(0);
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `新しい doc を作成した: ${file}\n.claude/rules/doc-placement.md に沿い、SSOT、文書化の必要性、削除時期、durable宣言を確認すること。`,
    },
  }),
);
