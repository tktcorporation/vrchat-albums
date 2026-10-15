#!/usr/bin/env bun
/**
 * Claude Code settings.json から共有 hook を起動するときの薄いラッパ。
 *
 * Cursor は third-party 設定で `.claude/settings.json` の hooks も読む。
 * 同時に `.cursor/hooks.json`（native）があると二重実行になるため、
 * Cursor 由来の入力で、かつ native hooks が存在するときは何もしない。
 *
 * `.cursor/run-shared-hook.ts` 経由では CURSOR_HOOK_VIA_ADAPTER=1 が立つのでスキップしない。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { projectDirectory, workingTree } from './hook-utils.ts';

const hookPath = process.argv[2];
if (!hookPath) throw new Error('shared hook path is required');

const inputText = await Bun.stdin.text();
let input: { cursor_version?: string } = {};
try {
  input = JSON.parse(inputText);
} catch {
  process.exit(0);
}

const viaAdapter = process.env.CURSOR_HOOK_VIA_ADAPTER === '1';
const projectDir = await projectDirectory();
const hasCursorNative = existsSync(join(projectDir, '.cursor/hooks.json'));
if (!viaAdapter && input.cursor_version && hasCursorNative) process.exit(0);

const tree = await workingTree();
const executable = isAbsolute(hookPath) ? hookPath : join(tree, hookPath);
const command = hookPath.endsWith('.ts') ? ['bun', executable] : [executable];
const processHandle = Bun.spawn(command, {
  cwd: tree,
  env: process.env,
  stdin: new Blob([inputText]),
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await processHandle.exited);
