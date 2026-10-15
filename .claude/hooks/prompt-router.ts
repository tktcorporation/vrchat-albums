#!/usr/bin/env bun
/**
 * UserPromptSubmit: ユーザーの依頼の型を見分け、その型で守るべき約束だけを文脈へ注入する。
 *
 * ルール文書は常時ロードされていても、依頼の場面で参照されないことがある。依頼文の言い回しから
 * 「委任」「説明要求」「レビューコメント対応」などの型を判定し、その場面に効く数行を依頼文の
 * 直後に添える。当たらなければ何も出さない（常時の文脈コストは増えない）。
 *
 * 型の一覧（正規表現と注入文）は .claude/hooks/project/prompt-routes.json が持つ。依頼の言い回しは
 * 使う人と言語に依存するので、この hook（テンプレートと共有する部分）には判定の仕組みだけを置き、
 * 語彙はプロジェクト側に置く。JSON が無ければ何もしない。
 *
 * JSON の形:
 *   { "max": 3, "routes": [ { "id": "委任", "pattern": "いい感じに|お任せ", "flags": "u", "context": "..." } ] }
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface Route {
  id: string;
  pattern: string;
  flags?: string;
  context: string;
}
interface Config {
  max?: number;
  routes?: Route[];
}

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const configPath = join(root, '.claude/hooks/project/prompt-routes.json');
if (!existsSync(configPath)) process.exit(0);

const input: { prompt?: string; user_prompt?: string } | null = await Bun.stdin
  .json()
  .catch(() => null);
const prompt = (input?.prompt ?? input?.user_prompt ?? '').trim();
// スラッシュコマンド、ツール出力の貼り付け、極端に短い入力は依頼文ではない
if (!prompt || prompt.startsWith('/') || prompt.startsWith('<') || prompt.length < 4)
  process.exit(0);

const config: Config | null = await Bun.file(configPath)
  .json()
  .catch(() => null);
const routes = (config?.routes ?? []).flatMap((route) => {
  try {
    return [{ ...route, regex: new RegExp(route.pattern, route.flags ?? 'u') }];
  } catch {
    return []; // 壊れた正規表現は、その型だけ無視する
  }
});
/** 1 回の依頼に注入する型の上限。多く当てても読まれないので絞る。 */
const limit = config?.max ?? 3;

const matched = routes.filter((route) => route.regex.test(prompt)).slice(0, limit);
if (matched.length === 0) process.exit(0);

const context = matched.map((route) => `【依頼の型: ${route.id}】${route.context}`).join('\n');
console.log(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  }),
);
