#!/usr/bin/env node

/**
 * 写真インデックス作成のメモリ計測ベンチマークを、MEMORY_PROFILE=1 を付けて起動する。
 *
 * package.json の scripts に `MEMORY_PROFILE=1 vitest ...` と書くと、Windows の cmd.exe は
 * 先頭を環境変数の代入ではなく実行ファイル名として扱うので起動できない。Node から環境変数を
 * 付けて vitest を起動すれば、どの OS でも同じコマンド（pnpm test:memory）で走る。
 * 追加の引数は vitest へそのまま渡す。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const TEST_FILE =
  'electron/module/vrchatPhoto/vrchatPhoto.memory.integration.test.ts';

// Windows で .cmd を shell なしに起動できないため、vitest の JS エントリを今の Node で直接起動する
const require = createRequire(import.meta.url);
const vitestPackageJsonPath = require.resolve('vitest/package.json');
const vitestPackageJson = JSON.parse(
  readFileSync(vitestPackageJsonPath, 'utf8'),
);
const vitestBin =
  typeof vitestPackageJson.bin === 'string'
    ? vitestPackageJson.bin
    : vitestPackageJson.bin.vitest;
const vitestEntry = path.join(path.dirname(vitestPackageJsonPath), vitestBin);

const result = spawnSync(
  process.execPath,
  [vitestEntry, 'run', TEST_FILE, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, MEMORY_PROFILE: '1' },
  },
);

// 終了コードが無い失敗（起動失敗・OOM killer 等によるシグナル終了）は理由を出してから失敗させる
if (result.error) {
  console.error(result.error);
} else if (result.status === null) {
  console.error(`vitest がシグナル ${result.signal} で終了しました`);
}

process.exit(result.status ?? 1);
