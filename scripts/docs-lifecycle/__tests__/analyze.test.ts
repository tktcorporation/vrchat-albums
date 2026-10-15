import { DateTime } from 'luxon';
import { describe, expect, it } from 'bun:test';
import { type AnalyzeInput, type DocSource, analyze } from '../analyze.ts';
import { parseConfig } from '../config.ts';

const NOW = DateTime.fromISO('2026-08-11T00:00:00Z', { zone: 'utc' });

const CONFIG = parseConfig({
  scan: ['docs/**/*.md'],
  staleDays: { ephemeral: 7, durable: 60 },
  defaultLifecycle: 'durable',
  policies: [
    { paths: ['docs/plans/**/*.md'], lifecycle: 'ephemeral', why: '使い捨ての設計メモ' },
    { paths: ['docs/generated/**/*.md'], lifecycle: 'generated', why: 'コードから生成される' },
  ],
  referencePrefixes: ['docs/'],
  referenceIgnoreFrom: ['worker/src/legacy/**'],
});

function doc(overrides: Partial<DocSource> & { path: string }): DocSource {
  return {
    content: '# 設計メモ\n',
    lastCommittedAt: NOW.minus({ days: 1 }).toISO(),
    ...overrides,
  };
}

function run(overrides: Partial<AnalyzeInput> & { docs: readonly DocSource[] }) {
  const existing = new Set(overrides.docs.map((source) => source.path));
  return analyze({
    config: CONFIG,
    references: [],
    pathExists: (path) => existing.has(path),
    now: NOW,
    historyAvailable: true,
    ...overrides,
  });
}

describe('analyze', () => {
  it('閾値を超えた ephemeral doc を stale として報告する', () => {
    const result = run({
      docs: [doc({ path: 'docs/plans/old.md', lastCommittedAt: NOW.minus({ days: 20 }).toISO() })],
    });

    expect(result.violations).toEqual([
      {
        kind: 'stale',
        path: 'docs/plans/old.md',
        lifecycle: 'ephemeral',
        ageDays: 20,
        limitDays: 7,
        referencedBy: [],
      },
    ]);
  });

  it('policy にマッチしない doc は defaultLifecycle の閾値で判定する', () => {
    const result = run({
      docs: [doc({ path: 'docs/overview.md', lastCommittedAt: NOW.minus({ days: 20 }).toISO() })],
    });

    expect(result.violations).toEqual([]);
    expect(result.statuses[0]).toMatchObject({ lifecycle: 'durable' });
  });

  it('frontmatter の lifecycle 宣言はパス由来の既定を上書きする', () => {
    const result = run({
      docs: [
        doc({
          path: 'docs/plans/keep.md',
          content: '---\nlifecycle: durable\n---\n\n# 長期保持する設計判断\n',
          lastCommittedAt: NOW.minus({ days: 20 }).toISO(),
        }),
      ],
    });

    expect(result.violations).toEqual([]);
    expect(result.statuses[0]).toMatchObject({ lifecycle: 'durable' });
  });

  it('review-by の猶予期間中は stale にしない', () => {
    const result = run({
      docs: [
        doc({
          path: 'docs/plans/in-progress.md',
          content: '---\nreview-by: 2026-08-25\nreview-reason: 移行の実装中\n---\n',
          lastCommittedAt: NOW.minus({ days: 30 }).toISO(),
        }),
      ],
    });

    expect(result.violations).toEqual([]);
    expect(result.statuses[0]?.verdict).toMatchObject({ kind: 'in-grace', until: '2026-08-25' });
  });

  it('review-by の期限切れを stale とは別に報告する', () => {
    const result = run({
      docs: [
        doc({
          path: 'docs/plans/expired.md',
          content: '---\nreview-by: 2026-08-01\nreview-reason: 延ばしすぎ\n---\n',
          lastCommittedAt: NOW.minus({ days: 30 }).toISO(),
        }),
      ],
    });

    expect(result.violations).toEqual([
      {
        kind: 'grace-expired',
        path: 'docs/plans/expired.md',
        until: '2026-08-01',
        referencedBy: [],
      },
    ]);
  });

  it('generated な doc は経過日数で判定しない', () => {
    const result = run({
      docs: [
        doc({
          path: 'docs/generated/coverage.md',
          lastCommittedAt: NOW.minus({ years: 1 }).toISO(),
        }),
      ],
    });

    expect(result.violations).toEqual([]);
    expect(result.statuses[0]?.verdict).toEqual({ kind: 'exempt' });
  });

  it('generated な doc への猶予宣言を違反として報告する（黙って無視しない）', () => {
    const result = run({
      docs: [
        doc({
          path: 'docs/generated/coverage.md',
          content: '---\nreview-by: 2026-09-01\nreview-reason: 進行中\n---\n',
        }),
      ],
    });

    expect(result.violations.map((violation) => violation.kind)).toEqual(['invalid-frontmatter']);
  });

  it('未コミットの doc を stale にしない', () => {
    const result = run({ docs: [doc({ path: 'docs/plans/new.md', lastCommittedAt: null })] });
    expect(result.violations).toEqual([]);
    expect(result.statuses[0]?.verdict).toEqual({ kind: 'uncommitted' });
  });

  it('doc 内の切れたリンクを報告する', () => {
    const result = run({
      docs: [doc({ path: 'docs/plans/plan.md', content: '詳細は [仕様](./spec.md) を参照。\n' })],
    });

    expect(result.violations).toEqual([
      { kind: 'broken-link', path: 'docs/plans/plan.md', line: 1, target: './spec.md' },
    ]);
  });

  it('削除済み doc を指したままの参照を報告する', () => {
    const result = run({
      docs: [doc({ path: 'docs/plans/plan.md' })],
      references: [
        { fromPath: 'worker/src/index.ts', line: 3, target: 'docs/plans/deleted.md' },
        { fromPath: 'worker/src/index.ts', line: 4, target: 'docs/plans/plan.md' },
      ],
    });

    expect(result.violations).toEqual([
      {
        kind: 'dangling-reference',
        fromPath: 'worker/src/index.ts',
        line: 3,
        target: 'docs/plans/deleted.md',
      },
    ]);
  });

  it('referencePrefixes の外を指す参照は検証しない', () => {
    const result = run({
      docs: [doc({ path: 'docs/plans/plan.md' })],
      references: [{ fromPath: 'worker/src/index.ts', line: 3, target: 'infra/README.md' }],
    });

    expect(result.violations).toEqual([]);
  });

  it('referenceIgnoreFrom にマッチする参照元は無視する', () => {
    const result = run({
      docs: [doc({ path: 'docs/plans/plan.md' })],
      references: [
        { fromPath: 'worker/src/legacy/old.ts', line: 3, target: 'docs/plans/deleted.md' },
      ],
    });

    expect(result.violations).toEqual([]);
  });

  it('参照元を doc ごとに集約し、自己参照は除く', () => {
    const result = run({
      docs: [doc({ path: 'docs/plans/plan.md', content: '自分自身: [ここ](./plan.md)\n' })],
      references: [
        { fromPath: 'worker/src/index.ts', line: 3, target: 'docs/plans/plan.md' },
        { fromPath: 'worker/src/index.ts', line: 3, target: 'docs/plans/plan.md' },
      ],
    });

    expect(result.statuses[0]?.referencedBy).toEqual([
      { fromPath: 'worker/src/index.ts', line: 3, target: 'docs/plans/plan.md' },
    ]);
  });

  it('不正な frontmatter を報告しつつ、パス由来のポリシーで鮮度判定を続ける', () => {
    const result = run({
      docs: [
        doc({
          path: 'docs/plans/broken.md',
          content: '---\nlifecycle: forever\n---\n',
          lastCommittedAt: NOW.minus({ days: 20 }).toISO(),
        }),
      ],
    });

    expect(result.violations.map((violation) => violation.kind)).toEqual([
      'invalid-frontmatter',
      'stale',
    ]);
  });
});
