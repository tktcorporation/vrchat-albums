#!/usr/bin/env node

/**
 * カスタム lint スクリプトの統合ランナー。
 *
 * 背景: 7個の tsx スクリプトを run-p で並列起動すると、
 * pnpm ランナー×7 (~600MB) + Node.js/tsx×7 (~700MB) で計1.3GB のメモリを消費し、
 * Codespaces 等のメモリ制限環境で OOM を引き起こしていた。
 * 1プロセスずつ順次実行することで、同時メモリ使用量を ~200MB に抑える。
 *
 * 各スクリプトはトップレベルで process.exit() を呼ぶため、
 * import での統合ではなくサブプロセスとして順次実行する。
 */

import { execFileSync } from 'node:child_process';

import consola from 'consola';

interface LintTask {
  name: string;
  script: string;
}

const tasks: LintTask[] = [
  { name: 'node-types', script: 'scripts/lint-node-types.ts' },
  { name: 'effect', script: 'scripts/lint-effect.ts' },
  { name: 'valueobjects', script: 'scripts/lint-valueobjects.ts' },
  { name: 'jsdoc-see', script: 'scripts/lint-jsdoc-see.ts' },
  { name: 'ts-pattern', script: 'scripts/lint-ts-pattern.ts' },
  { name: 'logger-level', script: 'scripts/lint-logger-level.ts' },
  { name: 'floating-promises', script: 'scripts/lint-floating-promises.ts' },
];

let allPassed = true;

for (const task of tasks) {
  try {
    execFileSync('tsx', [task.script], { stdio: 'inherit' });
  } catch {
    consola.error(`${task.name} failed`);
    allPassed = false;
  }
}

if (!allPassed) {
  process.exit(1);
}
