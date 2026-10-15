import { describe, expect, it } from 'bun:test';
import { parseDocMeta } from '../frontmatter.ts';

describe('parseDocMeta', () => {
  it('frontmatter が無い doc は空のメタとして扱う', () => {
    const result = parseDocMeta('# 設計メモ\n\n本文');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.meta).toEqual({ lifecycle: null, reviewBy: null, reviewReason: null });
    }
  });

  it('lifecycle 宣言を読み取る', () => {
    const result = parseDocMeta('---\nlifecycle: durable\n---\n\n本文');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.lifecycle).toBe('durable');
  });

  it('review-by と review-reason を対で読み取る', () => {
    const result = parseDocMeta(
      '---\nreview-by: 2026-09-01\nreview-reason: 移行の実装が 3 週間かかる\n---\n',
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.meta.reviewBy).toBe('2026-09-01');
      expect(result.meta.reviewReason).toBe('移行の実装が 3 週間かかる');
    }
  });

  it('入れ子になったキーをトップレベルの宣言として拾わない', () => {
    const result = parseDocMeta('---\nseo:\n  lifecycle: generated\n---\n');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.lifecycle).toBeNull();
  });

  it('lifecycle 系以外のキーは無視する', () => {
    const result = parseDocMeta('---\ntitle: 設計メモ\nlifecycle: ephemeral\n---\n');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.lifecycle).toBe('ephemeral');
  });

  it('インラインコメントだけの値を空として扱う（理由なしの猶予を許さない）', () => {
    const result = parseDocMeta('---\nreview-by: 2026-09-01\nreview-reason: # TODO\n---\n');
    expect(result.kind).toBe('invalid');
  });

  it('値に続くインラインコメントを落とす', () => {
    const result = parseDocMeta(
      '---\nreview-by: 2026-09-01\nreview-reason: 移行が進行中 # あとで消す\n---\n',
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.reviewReason).toBe('移行が進行中');
  });

  it('クオートされた値に続くコメントを落とす', () => {
    const result = parseDocMeta(
      '---\nreview-by: "2026-09-01" # 締め切り\nreview-reason: 理由\n---\n',
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.reviewBy).toBe('2026-09-01');
  });

  it('クオート内の # をコメントとして扱わない', () => {
    const result = parseDocMeta(
      '---\nreview-by: 2026-09-01\nreview-reason: "issue #123 の対応中"\n---\n',
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.reviewReason).toBe('issue #123 の対応中');
  });

  it('空白だけの理由を受け付けない', () => {
    const result = parseDocMeta('---\nreview-by: 2026-09-01\nreview-reason: "   "\n---\n');
    expect(result.kind).toBe('invalid');
  });

  it('YAML の null を理由として受け付けない', () => {
    for (const nullScalar of ['null', 'Null', 'NULL', '~']) {
      const result = parseDocMeta(
        `---\nreview-by: 2026-09-01\nreview-reason: ${nullScalar}\n---\n`,
      );
      expect(result.kind).toBe('invalid');
    }
  });

  it('クオートされた "null" は文字列として扱う', () => {
    const result = parseDocMeta('---\nreview-by: 2026-09-01\nreview-reason: "null"\n---\n');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.reviewReason).toBe('null');
  });

  it('クオート付きの値からクオートを外す', () => {
    const result = parseDocMeta('---\nreview-by: "2026-09-01"\nreview-reason: \'理由\'\n---\n');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.meta.reviewBy).toBe('2026-09-01');
      expect(result.meta.reviewReason).toBe('理由');
    }
  });

  it('未知の lifecycle 値を違反として報告する', () => {
    const result = parseDocMeta('---\nlifecycle: forever\n---\n');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.problems.join('\n')).toContain('lifecycle: forever');
    }
  });

  it('review-by だけで理由が無い猶予宣言を拒否する', () => {
    const result = parseDocMeta('---\nreview-by: 2026-09-01\n---\n');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.problems.join('\n')).toContain('review-reason');
    }
  });

  it('review-reason だけでは猶予されないことを報告する', () => {
    const result = parseDocMeta('---\nreview-reason: まだ実装中\n---\n');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.problems.join('\n')).toContain('review-by');
    }
  });

  it('実在しない日付を拒否する', () => {
    const result = parseDocMeta('---\nreview-by: 2026-02-31\nreview-reason: 理由\n---\n');
    expect(result.kind).toBe('invalid');
  });

  it('年だけの短縮形を拒否する（意図せず長い猶予にならないようにする）', () => {
    const result = parseDocMeta('---\nreview-by: 2027\nreview-reason: 理由\n---\n');
    expect(result.kind).toBe('invalid');
  });

  it('日時付きの ISO 文字列を拒否する', () => {
    const result = parseDocMeta('---\nreview-by: 2026-09-01T10:00:00Z\nreview-reason: 理由\n---\n');
    expect(result.kind).toBe('invalid');
  });

  it('月までの短縮形を拒否する', () => {
    const result = parseDocMeta('---\nreview-by: 2026-09\nreview-reason: 理由\n---\n');
    expect(result.kind).toBe('invalid');
  });

  it('閉じられていない frontmatter を違反として報告する', () => {
    const result = parseDocMeta('---\nlifecycle: durable\n\n# 本文\n');
    expect(result.kind).toBe('invalid');
  });

  it('ブロックスカラー内のインデントされた `---` で frontmatter を閉じない', () => {
    const result = parseDocMeta(
      [
        '---',
        'description: |',
        '  ---',
        '  区切り線に見える行',
        'review-by: 2026-09-01',
        'review-reason: 移行の実装中',
        '---',
        '',
        '# 本文',
        '',
      ].join('\n'),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.meta.reviewBy).toBe('2026-09-01');
      expect(result.meta.reviewReason).toBe('移行の実装中');
    }
  });

  it('インデントされた `---` で始まる doc を frontmatter として扱わない', () => {
    const result = parseDocMeta('  ---\nlifecycle: durable\n  ---\n');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.meta.lifecycle).toBeNull();
  });

  it('複数行スカラーをサイレントに無視せず違反として報告する', () => {
    const result = parseDocMeta('---\nreview-reason: |\n  長い理由\n---\n');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.problems.join('\n')).toContain('review-reason');
    }
  });
});
