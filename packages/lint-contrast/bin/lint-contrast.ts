#!/usr/bin/env tsx

/**
 * lint-contrast CLI エントリポイント。
 *
 * オプション解析と実行ロジックは src/cli.ts に委譲する。
 *
 * 使用方法:
 *   lint-contrast --project . --glob "src/**\/*.tsx"
 *
 * 詳細は --help を参照。
 */

import { runCli } from '../src/cli.js';

runCli(process.argv)
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    console.error('lint-contrast failed:', error);
    process.exit(1);
  });
