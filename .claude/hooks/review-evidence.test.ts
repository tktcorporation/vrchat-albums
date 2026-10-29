import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkReviewEvidence, createReviewEvidence } from './review-evidence.ts';

describe('review-evidence.ts', () => {
  test('Bun 専用のモジュールを静的に読み込まず、Node のテストランナーからも読み込める', () => {
    // hook-utils.ts と review-count.ts は `bun` を読み込む。静的な import に含めると、Node 上の
    // テストランナーで読み込んだ時点で "Cannot find package 'bun'" になる。
    const source = readFileSync(join(import.meta.dir, 'review-evidence.ts'), 'utf8');
    const staticImports = [...source.matchAll(/^import .* from '([^']+)';$/gmu)].map(
      (match) => match[1],
    );
    expect(staticImports.every((name) => name?.startsWith('node:'))).toBe(true);
  });

  test('作った証拠は同じ head・base・記録に対して通り、記録が変われば止まる', () => {
    const evidence = createReviewEvidence({
      headSha: 'a'.repeat(40),
      baseRef: 'origin/main',
      baseSha: 'b'.repeat(40),
      reviewer: 'codex',
      reportText: 'no findings',
      roundsText: 'rounds',
    });
    const expected = { headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), roundsText: 'rounds' };
    expect(checkReviewEvidence(evidence, expected)).toBeNull();
    expect(checkReviewEvidence(evidence, { ...expected, roundsText: 'changed' })).toBe(
      'Review rounds changed after evidence was recorded.',
    );
    expect(checkReviewEvidence([], expected)).toBe('Review evidence must be an object.');
  });
});
