#!/usr/bin/env bun
import { relative } from 'node:path';
import { readInput, workingTree } from './hook-utils.ts';
const input = await readInput();
const file = input?.tool_input?.file_path ?? input?.tool_input?.path;
if (!file) process.exit(0);

const basename = file.split(/[\\/]/).at(-1) ?? file;
const protectedFiles = new Set([
  '.oxlintrc.json',
  'sgconfig.yml',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  'eslint.config.js',
  'eslint.config.ts',
  'eslint.config.mjs',
  'biome.json',
  'biome.jsonc',
  '.prettierrc',
  '.prettierrc.json',
  'knip.json',
  'knip.ts',
]);
// 編集中の作業ツリー（worktree を含む）を基準に相対化する。主チェックアウト基準だと
// worktree 内の絶対パスが相対化されず、ast-grep ルールの保護をすり抜ける。
const tree = await workingTree(input);
const relativePath = file.startsWith(`${tree}/`) ? relative(tree, file) : file;
const astGrepRule = /^(?:rules|\.ast-grep\/rules)\/[^/]+\.yml$/.test(relativePath);

if (protectedFiles.has(basename) || astGrepRule) {
  const kind = astGrepRule
    ? `ast-grep ルールファイル (${basename})`
    : `${basename} はリンター設定ファイル`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `BLOCKED: ${kind}です。設定ではなくコードを修正してください。変更が必要なら理由を説明してユーザーに確認してください。`,
      },
    }),
  );
}
