#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { hasMiseTask, readInput, runMiseTask, workingTree } from './hook-utils.ts';
const input = await readInput();
if (!input) process.exit(0);
process.chdir(await workingTree(input));
if (!(await hasMiseTask('claude-postedit'))) process.exit(0);
const file = input.tool_input?.file_path ?? input.tool_input?.path;
if (!file || !existsSync(file)) process.exit(0);
const result = await runMiseTask('claude-postedit', [file], 120_000);
if (result.exitCode === 0) process.exit(0);
const message = result.timedOut
  ? 'claude-postedit がタイムアウトしました（120秒超過）。'
  : result.output;
if (message)
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `⚠ post-edit check failed:\n${message}\nFix these issues before proceeding.`,
      },
    }),
  );
