import { DateTime } from 'luxon';
import { describe, expect, it } from 'bun:test';
import type { DocMeta } from '../frontmatter.ts';
import {
  GIT_LOG_COMMIT_MARKER,
  type FreshnessInput,
  judgeFreshness,
  parseGitLogFileDates,
} from '../freshness.ts';

const NOW = DateTime.fromISO('2026-08-11T00:00:00Z', { zone: 'utc' });
const NO_META: DocMeta = { lifecycle: null, reviewBy: null, reviewReason: null };

function input(overrides: Partial<FreshnessInput>): FreshnessInput {
  return {
    lifecycle: 'ephemeral',
    lastCommittedAt: NOW.minus({ days: 1 }),
    meta: NO_META,
    limitDays: 7,
    now: NOW,
    historyAvailable: true,
    ...overrides,
  };
}

describe('judgeFreshness', () => {
  it('閾値内なら fresh', () => {
    expect(judgeFreshness(input({ lastCommittedAt: NOW.minus({ days: 7 }) }))).toEqual({
      kind: 'fresh',
      ageDays: 7,
      limitDays: 7,
    });
  });

  it('閾値を超えたら stale', () => {
    expect(judgeFreshness(input({ lastCommittedAt: NOW.minus({ days: 8 }) }))).toEqual({
      kind: 'stale',
      ageDays: 8,
      limitDays: 7,
    });
  });

  it('generated（limitDays が null）は鮮度チェックの対象外', () => {
    expect(
      judgeFreshness(
        input({
          lifecycle: 'generated',
          limitDays: null,
          lastCommittedAt: NOW.minus({ years: 1 }),
        }),
      ),
    ).toEqual({ kind: 'exempt' });
  });

  it('git 履歴が読めない（shallow clone）なら鮮度を判定しない', () => {
    const verdict = judgeFreshness(
      input({ historyAvailable: false, lastCommittedAt: NOW.minus({ days: 100 }) }),
    );
    expect(verdict).toEqual({ kind: 'history-unavailable' });
  });

  it('git 履歴が読めなくても review-by の期限切れは検知する', () => {
    const verdict = judgeFreshness(
      input({
        historyAvailable: false,
        lastCommittedAt: NOW.minus({ days: 100 }),
        meta: { lifecycle: null, reviewBy: '2026-08-01', reviewReason: '期限切れ' },
      }),
    );
    expect(verdict).toEqual({ kind: 'grace-expired', until: '2026-08-01', ageDays: null });
  });

  it('git 履歴が読めないときは経過日数を出さない', () => {
    const verdict = judgeFreshness(
      input({
        historyAvailable: false,
        lastCommittedAt: NOW.minus({ days: 100 }),
        meta: { lifecycle: null, reviewBy: '2026-08-25', reviewReason: '進行中' },
      }),
    );
    expect(verdict).toMatchObject({ kind: 'in-grace', ageDays: null });
  });

  it('git 履歴に無い doc は未コミット扱いで違反にしない', () => {
    expect(judgeFreshness(input({ lastCommittedAt: null }))).toEqual({ kind: 'uncommitted' });
  });

  it('review-by が未来なら猶予期間中として扱う', () => {
    const verdict = judgeFreshness(
      input({
        lastCommittedAt: NOW.minus({ days: 30 }),
        meta: { lifecycle: null, reviewBy: '2026-08-25', reviewReason: '移行の実装中' },
      }),
    );
    expect(verdict).toEqual({
      kind: 'in-grace',
      until: '2026-08-25',
      reason: '移行の実装中',
      ageDays: 30,
    });
  });

  it('review-by の当日はまだ猶予される', () => {
    const verdict = judgeFreshness(
      input({
        lastCommittedAt: NOW.minus({ days: 30 }),
        meta: { lifecycle: null, reviewBy: '2026-08-11', reviewReason: '当日' },
      }),
    );
    expect(verdict.kind).toBe('in-grace');
  });

  it('review-by を過ぎたら期限切れとして報告する', () => {
    const verdict = judgeFreshness(
      input({
        lastCommittedAt: NOW.minus({ days: 30 }),
        meta: { lifecycle: null, reviewBy: '2026-08-10', reviewReason: '延ばしすぎ' },
      }),
    );
    expect(verdict).toEqual({ kind: 'grace-expired', until: '2026-08-10', ageDays: 30 });
  });

  it('猶予宣言は閾値内でも優先される（期限を過ぎていれば報告する）', () => {
    const verdict = judgeFreshness(
      input({
        lastCommittedAt: NOW.minus({ days: 1 }),
        meta: { lifecycle: null, reviewBy: '2026-08-01', reviewReason: '古い宣言' },
      }),
    );
    expect(verdict.kind).toBe('grace-expired');
  });

  it('未来のコミット日時でも経過日数は負にならない', () => {
    const verdict = judgeFreshness(input({ lastCommittedAt: NOW.plus({ days: 3 }) }));
    expect(verdict).toEqual({ kind: 'fresh', ageDays: 0, limitDays: 7 });
  });
});

describe('parseGitLogFileDates', () => {
  const marker = GIT_LOG_COMMIT_MARKER;

  it('パスごとに最も新しいコミット日時を採る', () => {
    const output = [
      `${marker}2026-08-11T10:00:00+09:00`,
      'docs/a.md',
      'docs/b.md',
      '',
      `${marker}2026-07-01T10:00:00+09:00`,
      'docs/a.md',
      'docs/c.md',
    ].join('\n');

    expect(parseGitLogFileDates(output)).toEqual(
      new Map([
        ['docs/a.md', '2026-08-11T10:00:00+09:00'],
        ['docs/b.md', '2026-08-11T10:00:00+09:00'],
        ['docs/c.md', '2026-07-01T10:00:00+09:00'],
      ]),
    );
  });

  it('空の出力（履歴なし）は空の Map になる', () => {
    expect(parseGitLogFileDates('')).toEqual(new Map());
  });

  it('日時行より前に現れたパスは無視する', () => {
    expect(parseGitLogFileDates('docs/orphan.md\n')).toEqual(new Map());
  });
});
