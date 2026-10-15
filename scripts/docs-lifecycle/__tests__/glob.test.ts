import { describe, expect, it } from 'bun:test';
import { matchesAnyGlob, matchesGlob } from '../glob.ts';

describe('matchesGlob', () => {
  it('`**` はサブディレクトリと直下の両方にマッチする', () => {
    expect(matchesGlob('docs/plans/design.md', 'docs/**/*.md')).toBe(true);
    expect(matchesGlob('docs/overview.md', 'docs/**/*.md')).toBe(true);
    expect(matchesGlob('docs/a/b/c/design.md', 'docs/**/*.md')).toBe(true);
  });

  it('`*` はディレクトリ区切りを越えない', () => {
    expect(matchesGlob('docs/overview.md', 'docs/*.md')).toBe(true);
    expect(matchesGlob('docs/plans/overview.md', 'docs/*.md')).toBe(false);
  });

  it('スコープ外のパスにはマッチしない', () => {
    expect(matchesGlob('worker/src/index.ts', 'docs/**/*.md')).toBe(false);
    expect(matchesGlob('README.md', 'docs/**/*.md')).toBe(false);
  });

  it('パターン中のドットをワイルドカードとして解釈しない', () => {
    expect(matchesGlob('docsXplans/a.md', 'docs/**/*.md')).toBe(false);
    expect(matchesGlob('docs/overviewXmd', 'docs/*.md')).toBe(false);
  });

  it('`?` は 1 文字にマッチする', () => {
    expect(matchesGlob('docs/a.md', 'docs/?.md')).toBe(true);
    expect(matchesGlob('docs/ab.md', 'docs/?.md')).toBe(false);
  });
});

describe('matchesAnyGlob', () => {
  it('いずれかのパターンにマッチすれば true', () => {
    expect(matchesAnyGlob('infra/README.md', ['docs/**/*.md', 'infra/**/*.md'])).toBe(true);
  });

  it('空のパターン配列は常に false（除外リスト未設定で全除外にならない）', () => {
    expect(matchesAnyGlob('docs/a.md', [])).toBe(false);
  });
});
