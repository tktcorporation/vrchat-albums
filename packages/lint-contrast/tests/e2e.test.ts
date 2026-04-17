/**
 * フィクスチャに対する end-to-end テスト。
 *
 * 実際の TSX フィクスチャを処理して期待通りの severity を返すか確認する。
 * parseCssVars → collectJsxStacks → classifyStack → evaluateContrast の
 * 全パイプラインを通して検証する。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyStack } from '../src/classify.js';
import { collectJsxStacks } from '../src/collectJsxStacks.js';
import {
  wcagContrastRatio,
  WCAG_AA_THRESHOLD,
} from '../src/evaluateContrast.js';
import { parseCssVars } from '../src/parseCssVars.js';
import type { Theme } from '../src/types.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../test-fixtures');
const MOCK_CSS = path.join(FIXTURES_DIR, 'mock-index.css');

const cssVars = parseCssVars(MOCK_CSS);

// ---------------------------------------------------------------------------
// ok-card-on-background.tsx: bg-background + text-foreground → no error
// ---------------------------------------------------------------------------

describe('ok-card-on-background.tsx', () => {
  it('produces no errors for bg-background + text-foreground (both modes AA)', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ok-card-on-background.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ok-card-on-background.tsx', source);
    expect(stacks.length).toBeGreaterThan(0);

    const errors: string[] = [];
    for (const stack of stacks) {
      const resolution = classifyStack(stack, cssVars);
      if (resolution.kind === 'resolvable') {
        for (const theme of ['light', 'dark'] as Theme[]) {
          const { bg, fg } = resolution.themes[theme];
          const ratio = wcagContrastRatio(fg, bg);
          if (ratio < WCAG_AA_THRESHOLD) {
            errors.push(`${theme}: ratio=${ratio.toFixed(2)}`);
          }
        }
      }
    }

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// skip-no-colors.tsx: className に bg/text なし → skip
// ---------------------------------------------------------------------------

describe('skip-no-colors.tsx', () => {
  it('produces no stacks (collectJsxStacks returns empty)', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'skip-no-colors.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('skip-no-colors.tsx', source);
    expect(stacks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// warn-dynamic-class.tsx: cn(dynamicVar) → unknown → warning のみ
// ---------------------------------------------------------------------------

describe('warn-dynamic-class.tsx', () => {
  it('produces at least one unknown (→ warning) resolution', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'warn-dynamic-class.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('warn-dynamic-class.tsx', source);

    // Template literal with dynamic expression → dynamic branchLabel
    const unknowns = stacks
      .map((s) => classifyStack(s, cssVars))
      .filter((r) => r.kind === 'unknown');

    expect(unknowns.length).toBeGreaterThan(0);
  });

  it('produces no errors (unknown → warning, not error)', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'warn-dynamic-class.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('warn-dynamic-class.tsx', source);

    const errors = stacks
      .map((s) => classifyStack(s, cssVars))
      .filter((r) => {
        if (r.kind !== 'resolvable') {
          return false;
        }
        return (
          wcagContrastRatio(r.themes.light.fg, r.themes.light.bg) <
            WCAG_AA_THRESHOLD ||
          wcagContrastRatio(r.themes.dark.fg, r.themes.dark.bg) <
            WCAG_AA_THRESHOLD
        );
      });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ng-alpha-composite.tsx: bg-white/30 合成後に低コントラスト → error
// ---------------------------------------------------------------------------

describe('ng-alpha-composite.tsx', () => {
  it('produces at least one resolvable stack with alpha composite bg', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ng-alpha-composite.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-alpha-composite.tsx', source);

    const resolvable = stacks
      .map((s) => classifyStack(s, cssVars))
      .filter((r) => r.kind === 'resolvable');

    expect(resolvable.length).toBeGreaterThan(0);
  });

  it('has at least one theme with contrast below AA (due to alpha composite)', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ng-alpha-composite.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-alpha-composite.tsx', source);

    const violations: { theme: Theme; ratio: number }[] = [];
    for (const stack of stacks) {
      const resolution = classifyStack(stack, cssVars);
      if (resolution.kind !== 'resolvable') {
        continue;
      }
      for (const theme of ['light', 'dark'] as Theme[]) {
        const { bg, fg } = resolution.themes[theme];
        const ratio = wcagContrastRatio(fg, bg);
        if (ratio < WCAG_AA_THRESHOLD) {
          violations.push({ theme, ratio });
        }
      }
    }

    // The alpha composite of bg-white/30 + text-muted-foreground should fail
    expect(violations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ng-low-contrast-dark.tsx: ダークモードで低コントラスト → error
// ---------------------------------------------------------------------------

describe('ng-low-contrast-dark.tsx', () => {
  it('produces at least one resolvable stack', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ng-low-contrast-dark.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-low-contrast-dark.tsx', source);

    const resolvable = stacks
      .map((s) => classifyStack(s, cssVars))
      .filter((r) => r.kind === 'resolvable');

    expect(resolvable.length).toBeGreaterThan(0);
  });

  it('passes AA in light mode but fails in dark mode', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ng-low-contrast-dark.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-low-contrast-dark.tsx', source);

    const violations: { theme: Theme; ratio: number }[] = [];
    const passes: { theme: Theme; ratio: number }[] = [];

    for (const stack of stacks) {
      const resolution = classifyStack(stack, cssVars);
      if (resolution.kind !== 'resolvable') {
        continue;
      }
      for (const theme of ['light', 'dark'] as Theme[]) {
        const { bg, fg } = resolution.themes[theme];
        const ratio = wcagContrastRatio(fg, bg);
        if (ratio < WCAG_AA_THRESHOLD) {
          violations.push({ theme, ratio });
        } else {
          passes.push({ theme, ratio });
        }
      }
    }

    // ダークモードで違反が発生すること
    expect(violations.some((v) => v.theme === 'dark')).toBe(true);
    // ライトモードは AA クリアすること
    expect(passes.some((p) => p.theme === 'light')).toBe(true);
  });

  it('light mode ratio >= 6.0 (sufficient margin above AA threshold 4.5)', () => {
    // --low-fg: 0 0% 35% vs --low-bg: 0 0% 100% → ratio ≈ 6.98
    // Verify the margin is wide enough to prevent flaky failures.
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ng-low-contrast-dark.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-low-contrast-dark.tsx', source);

    const lightRatios: number[] = [];
    for (const stack of stacks) {
      const resolution = classifyStack(stack, cssVars);
      if (resolution.kind !== 'resolvable') {
        continue;
      }
      const { bg, fg } = resolution.themes.light;
      lightRatios.push(wcagContrastRatio(fg, bg));
    }

    expect(lightRatios.length).toBeGreaterThan(0);
    // 全ライトモードスタックが 6.0 以上であること (AA 閾値 4.5 に対して +1.5 以上の余裕)
    for (const r of lightRatios) {
      expect(r).toBeGreaterThanOrEqual(6);
    }
  });

  it('dark mode ratio < 3.0 (clearly fails AA threshold 4.5)', () => {
    // --low-fg: 0 0% 40% vs --low-bg: 0 0% 15% → ratio ≈ 2.63
    // Verify the dark mode ratio is far enough below AA to prevent flaky passes.
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ng-low-contrast-dark.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-low-contrast-dark.tsx', source);

    const darkViolations: number[] = [];
    for (const stack of stacks) {
      const resolution = classifyStack(stack, cssVars);
      if (resolution.kind !== 'resolvable') {
        continue;
      }
      const { bg, fg } = resolution.themes.dark;
      const r = wcagContrastRatio(fg, bg);
      if (r < WCAG_AA_THRESHOLD) {
        darkViolations.push(r);
      }
    }

    expect(darkViolations.length).toBeGreaterThan(0);
    // ダークモードの比率が 3.0 未満であること (flaky 防止の余裕)
    for (const r of darkViolations) {
      expect(r).toBeLessThan(3);
    }
  });
});

// ---------------------------------------------------------------------------
// ok-dark-variant.tsx: dark: バリアントを使用した両モード AA クリアの典型例
// ---------------------------------------------------------------------------

describe('ok-dark-variant.tsx', () => {
  it('produces no errors: dark: variants resolve correctly in both modes', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ok-dark-variant.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ok-dark-variant.tsx', source);
    expect(stacks.length).toBeGreaterThan(0);

    const errors: string[] = [];
    const unknowns: string[] = [];
    for (const stack of stacks) {
      const resolution = classifyStack(stack, cssVars);
      if (resolution.kind === 'unknown') {
        unknowns.push(resolution.reason);
      }
      if (resolution.kind === 'resolvable') {
        for (const theme of ['light', 'dark'] as Theme[]) {
          const { bg, fg } = resolution.themes[theme];
          const ratio = wcagContrastRatio(fg, bg);
          if (ratio < WCAG_AA_THRESHOLD) {
            errors.push(`${theme}: ratio=${ratio.toFixed(2)}`);
          }
        }
      }
    }

    // dark: バリアントが light モードで unknown に落ちていないこと
    expect(unknowns).toHaveLength(0);
    // 両モードで AA クリアすること
    expect(errors).toHaveLength(0);
  });

  it('both light and dark themes are resolvable (dark: prefix does not cause unknown)', () => {
    const source = readFileSync(
      path.join(FIXTURES_DIR, 'ok-dark-variant.tsx'),
      'utf8',
    );
    const stacks = collectJsxStacks('ok-dark-variant.tsx', source);

    const resolvable = stacks
      .map((s) => classifyStack(s, cssVars))
      .filter((r) => r.kind === 'resolvable');

    // dark: バリアントが unknown に落ちず、resolvable として解決されること
    expect(resolvable.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: parseCssVars → resolveClass → compositeOver → evaluateContrast
// ---------------------------------------------------------------------------

describe('Integration pipeline', () => {
  it('bg-background/text-foreground passes AA in both modes', () => {
    // Direct calculation test without classify
    const lightBg = cssVars.light['--background'];
    const lightFg = cssVars.light['--foreground'];
    const darkBg = cssVars.dark['--background'];
    const darkFg = cssVars.dark['--foreground'];

    expect(lightBg).toBeDefined();
    expect(lightFg).toBeDefined();
    expect(darkBg).toBeDefined();
    expect(darkFg).toBeDefined();

    expect(wcagContrastRatio(lightFg, lightBg)).toBeGreaterThan(
      WCAG_AA_THRESHOLD,
    );
    expect(wcagContrastRatio(darkFg, darkBg)).toBeGreaterThan(
      WCAG_AA_THRESHOLD,
    );
  });
});
