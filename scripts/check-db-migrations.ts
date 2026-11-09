#!/usr/bin/env node

/**
 * DB のテーブル定義（electron/lib/db/schema.ts）とマイグレーション（electron/lib/db/migrations/）が
 * 食い違っていないかを確かめる。
 *
 * テーブル定義を変えたのにマイグレーションを生成し忘れると、利用者の DB には変更が届かないまま、
 * アプリは新しい定義で読み書きして失敗する。`drizzle-kit generate --explain` は、生成した場合の
 * 差分を書き出さずに返すので、差分が無い（no_changes）ことを確かめる。
 * 併せて `drizzle-kit check` で、マイグレーションどうしの衝突が無いことを確かめる。
 */

import { spawnSync } from 'node:child_process';

import consola from 'consola';
import { z } from 'zod';

const ExplainOutputSchema = z.object({ status: z.string() });

const runDrizzleKit = (args: string[]) =>
  spawnSync('pnpm', ['exec', 'drizzle-kit', ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

const explain = runDrizzleKit(['generate', '--explain', '--output', 'json']);
if (explain.status !== 0) {
  consola.error(explain.stderr || explain.stdout);
  process.exit(1);
}

const jsonLine = explain.stdout
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line.startsWith('{'));
const parsed = ExplainOutputSchema.safeParse(
  jsonLine === undefined ? undefined : JSON.parse(jsonLine),
);
if (!parsed.success) {
  consola.error(
    `drizzle-kit generate --explain の出力を読めませんでした:\n${explain.stdout}`,
  );
  process.exit(1);
}
if (parsed.data.status !== 'no_changes') {
  consola.error(
    'electron/lib/db/schema.ts の変更に対応するマイグレーションがありません。`pnpm db:generate --name <名前>` で生成してください。\n' +
      explain.stdout,
  );
  process.exit(1);
}

const check = runDrizzleKit(['check']);
if (check.status !== 0) {
  consola.error(check.stderr || check.stdout);
  process.exit(1);
}

consola.success('DB のテーブル定義とマイグレーションは一致しています');
