#!/usr/bin/env bun
import { $ } from 'bun';
console.log('mise のセットアップ状況を確認中...');
await $`mise list`;
console.log(`📌 Node.js バージョン: ${(await $`mise exec -- node --version`.text()).trim()}`);
console.log('📦 システム依存関係をインストール中...');
await $`mise exec -- playwright install-deps chromium`;
console.log('📦 Chromium をインストール中...');
await $`mise exec -- playwright install chromium`;
const paths = [
  ...new Bun.Glob('.cache/ms-playwright/chromium-*/chrome-linux/chrome').scanSync({
    cwd: process.env.HOME,
  }),
];
console.log(`✅ セットアップ完了: ${paths[0] ?? 'not found'}`);
const check = await $`mise exec -- chrome-devtools-mcp --help`.quiet().nothrow();
console.log(
  check.exitCode === 0
    ? '✅ Chrome DevTools MCP が正常に動作します'
    : '⚠️ Chrome DevTools MCP の実行に問題があります',
);
