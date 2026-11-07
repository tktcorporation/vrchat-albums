#!/usr/bin/env bun
import { isAbsolute, relative, resolve, sep } from 'node:path';
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
// `path.sep` が Windows では `\` になるため、`/` 固定のプレフィックス比較ではなく
// relative() の結果（tree 外なら `..` から始まるか絶対パスになる）で判定する。
const tree = await workingTree(input);
// 相対パスは hook の実行場所ではなく作業ツリーからのパスとして渡される。`./` や `..` を含む書き方で
// 判定をすり抜けないよう、作業ツリーを起点に解決してから相対化する。
const rel = relative(tree, resolve(tree, file));
const isWithinTree = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
// 下の正規表現は `/` 区切り前提。relative() は Windows では `\` を返すため、
// 判定直前に揃える（tree 外で file をそのまま使う分岐も、Windows の絶対パスは
// 元から `\` なので同様に正規化する）。
const relativePath = (isWithinTree ? rel : file).replaceAll('\\', '/');
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
