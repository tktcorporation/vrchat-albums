#!/usr/bin/env node

/**
 * lint-contrast のクロスプラットフォームランナー。
 *
 * Windows cmd.exe では `$INIT_CWD` が展開されないため、
 * package.json の scripts から直接 `--project $INIT_CWD` を渡すと
 * リテラル文字列 "$INIT_CWD" が --project に渡ってしまう (C1 修正)。
 *
 * このスクリプトは Node.js で `process.env.INIT_CWD || process.cwd()` を
 * 読んでプロジェクトルートを解決し、lint-contrast を spawn する。
 * 追加 argv はそのまま転送される (--format, --threshold 等)。
 */

import { spawnSync } from 'node:child_process';

// pnpm が設定する INIT_CWD (npm lifecycle で設定される) を使用。
// 未設定の場合は process.cwd() にフォールバック。
const projectRoot = process.env.INIT_CWD ?? process.cwd();

// process.argv[2..] を追加引数として転送する
const extraArgs = process.argv.slice(2);

const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@vrchat-albums/lint-contrast',
    'run',
    'lint-contrast',
    '--',
    '--project',
    projectRoot,
    ...extraArgs,
  ],
  {
    stdio: 'inherit',
    // Windows では shell: true が必要
    shell: process.platform === 'win32',
  },
);

// lint-contrast が返す exit code をそのまま伝播する
process.exit(result.status ?? 1);
