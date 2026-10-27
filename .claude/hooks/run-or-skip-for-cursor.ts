#!/usr/bin/env bun
/**
 * Claude Code settings.json から共有 hook を起動するときの薄いラッパ。
 *
 * Cursor は third-party 設定で `.claude/settings.json` の hooks も読む。
 * 同時に `.cursor/hooks.json`（native）があると二重実行になるため、
 * Cursor 由来の入力で、かつ native hooks が存在するときは何もしない。
 *
 * `.cursor/run-shared-hook.ts` 経由では CURSOR_HOOK_VIA_ADAPTER=1 が立つのでスキップしない。
 *
 * 相対パスの hook は、このラッパーが置かれたプロジェクトを基準に解く。プロセスの現在地
 * （サブモジュールの中などセッションの作業場所）を基準にすると、そこに無いファイルを指して
 * hook が動かない。見つからないときは黙って通さず、PreToolUse ではツールを止める。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { projectDirectory, workingTree } from './hook-utils.ts';

const hookPath = process.argv[2];
if (!hookPath) throw new Error('shared hook path is required');

const inputText = await Bun.stdin.text();
let input: { cursor_version?: string; hook_event_name?: string } = {};
try {
  input = JSON.parse(inputText);
} catch {
  process.exit(0);
}

const viaAdapter = process.env.CURSOR_HOOK_VIA_ADAPTER === '1';
const projectDir = await projectDirectory();
const hasCursorNative = existsSync(join(projectDir, '.cursor/hooks.json'));
if (!viaAdapter && input.cursor_version && hasCursorNative) process.exit(0);

const executable = isAbsolute(hookPath) ? hookPath : join(import.meta.dir, '../..', hookPath);
if (!existsSync(executable)) {
  console.error(`hook が見つかりません: ${executable}`);
  process.exit(input.hook_event_name === 'PreToolUse' ? 2 : 1);
}
const tree = await workingTree();
const command = hookPath.endsWith('.ts') ? ['bun', executable] : [executable];
const processHandle = Bun.spawn(command, {
  cwd: tree,
  env: process.env,
  stdin: new Blob([inputText]),
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await processHandle.exited);
