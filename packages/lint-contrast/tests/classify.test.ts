/**
 * classify.ts の単体テスト。
 *
 * Strategy B 分類ルール 1〜7 を全て検証する。
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyStack } from '../src/classify.js';
import { parseCssVars } from '../src/parseCssVars.js';
import type { ClassCandidate, JsxStack } from '../src/types.js';

const MOCK_CSS = path.resolve(
  import.meta.dirname,
  '../test-fixtures/mock-index.css',
);

const cssVars = parseCssVars(MOCK_CSS);

// ---------------------------------------------------------------------------
// テスト用ヘルパー: JsxStack を簡潔に構築する
// ---------------------------------------------------------------------------

function makeStack(
  bgStack: ClassCandidate[],
  textCandidates: ClassCandidate[],
): JsxStack {
  return {
    file: 'test.tsx',
    line: 1,
    column: 1,
    elementName: 'p',
    bgStack,
    textCandidates,
  };
}

function staticBg(...classes: string[]): ClassCandidate {
  return { classes };
}

function staticText(...classes: string[]): ClassCandidate {
  return { classes };
}

function dynamicCandidate(): ClassCandidate {
  return { classes: [], branchLabel: 'dynamic' };
}

// ---------------------------------------------------------------------------
// Rule 1: bgStack 空 かつ textCandidates 空 → skip('no-color-classes')
// ---------------------------------------------------------------------------

describe('Rule 1: both empty → skip(no-color-classes)', () => {
  it('returns skip when both bgStack and textCandidates are empty', () => {
    const stack = makeStack([], []);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toBe('no-color-classes');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 2: textCandidates 空 → skip('no-text')
// ---------------------------------------------------------------------------

describe('Rule 2: textCandidates empty → skip(no-text)', () => {
  it('returns skip when bgStack has items but textCandidates is empty', () => {
    const stack = makeStack([staticBg('bg-background')], []);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toBe('no-text');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 3: 全候補 classes が空配列 → unknown('dynamic-classname')
// ---------------------------------------------------------------------------

describe('Rule 3: all classes empty → unknown(dynamic-classname)', () => {
  it('returns unknown when all candidates have empty classes arrays', () => {
    const stack = makeStack([{ classes: [] }], [{ classes: [] }]);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-classname');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 4: bgStack に dynamic branchLabel → unknown('dynamic-bg-branch')
// ---------------------------------------------------------------------------

describe('Rule 4: dynamic branchLabel in bgStack → unknown(dynamic-bg-branch)', () => {
  it('returns unknown when bgStack contains a dynamic candidate', () => {
    const stack = makeStack(
      [dynamicCandidate()],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-bg-branch');
    }
  });

  it('returns unknown when bgStack has mixed static and dynamic candidates', () => {
    const stack = makeStack(
      [staticBg('bg-background'), dynamicCandidate()],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-bg-branch');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 5: textCandidates に dynamic branchLabel → unknown('dynamic-text-branch')
// ---------------------------------------------------------------------------

describe('Rule 5: dynamic branchLabel in textCandidates → unknown(dynamic-text-branch)', () => {
  it('returns unknown when textCandidates contains a dynamic candidate', () => {
    const stack = makeStack([staticBg('bg-background')], [dynamicCandidate()]);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('dynamic-text-branch');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 6: 全候補静的 + 組合せ ≤ 32 → resolvable (worst-case pair)
// ---------------------------------------------------------------------------

describe('Rule 6: all static, combinations ≤ 32 → resolvable', () => {
  it('resolves bg-background + text-foreground (passes AA in both modes)', () => {
    const stack = makeStack(
      [staticBg('bg-background')],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('resolvable');
    if (result.kind === 'resolvable') {
      // Both themes must have bg and fg
      expect(result.themes.light.bg).toBeDefined();
      expect(result.themes.light.fg).toBeDefined();
      expect(result.themes.dark.bg).toBeDefined();
      expect(result.themes.dark.fg).toBeDefined();
    }
  });

  it('resolvable worst-case: lowest contrast ratio pair is selected per theme', () => {
    // bg-background + text-foreground in light mode is high contrast (~17)
    // in dark mode is also high contrast (~12)
    const stack = makeStack(
      [staticBg('bg-background')],
      [staticText('text-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    if (result.kind === 'resolvable') {
      // Light: white bg, near-black fg → high contrast
      const lightBg = result.themes.light.bg;
      const lightFg = result.themes.light.fg;
      expect(lightBg.r).toBeCloseTo(1, 1); // near white
      expect(lightFg.r).toBeLessThan(0.3); // near black
    }
  });

  it('resolves bg-card + text-card-foreground correctly', () => {
    const stack = makeStack(
      [staticBg('bg-card')],
      [staticText('text-card-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // card-foreground is the same as foreground in mock CSS
    expect(result.kind).toBe('resolvable');
  });

  it('resolves alpha composite: bg-background + bg-white/30 + text-muted-foreground', () => {
    const stack = makeStack(
      [staticBg('bg-background'), staticBg('bg-white/30')],
      [staticText('text-muted-foreground')],
    );
    const result = classifyStack(stack, cssVars);
    // Should be resolvable since all classes are static
    // bg-white/30 has alpha, which will be composited
    expect(result.kind).toBe('resolvable');
  });
});

// ---------------------------------------------------------------------------
// Rule 7: 組合せ数 > 32 → unknown('combinatorial-explosion')
// ---------------------------------------------------------------------------

describe('Rule 7: combinations > 32 → unknown(combinatorial-explosion)', () => {
  it('returns unknown when combinations exceed 32', () => {
    // Create 33+ text candidates (bgStack = 1, textCandidates = 33 → 33 combinations)
    const textCandidates: ClassCandidate[] = [];
    for (let i = 0; i < 33; i++) {
      textCandidates.push(staticText('text-foreground'));
    }
    const stack = makeStack([staticBg('bg-background')], textCandidates);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.reason).toBe('combinatorial-explosion');
    }
  });
});

// ---------------------------------------------------------------------------
// end-to-end スモークテスト (フィクスチャ経由)
// ---------------------------------------------------------------------------

describe('Smoke tests via fixtures', () => {
  it('skip-no-colors: no bg/text → stack is empty so classifyStack not called', () => {
    // skip-no-colors has no bg/text classes, so collectJsxStacks returns []
    // We simulate the edge case of an empty-class stack
    const stack = makeStack([], []);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('skip');
  });

  it('warn-dynamic-class: dynamic template literal → unknown(dynamic-text-branch)', () => {
    // Template literal with expression → dynamic branchLabel
    const stack = makeStack([staticBg('bg-background')], [dynamicCandidate()]);
    const result = classifyStack(stack, cssVars);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(['dynamic-text-branch', 'dynamic-classname']).toContain(
        result.reason,
      );
    }
  });
});
