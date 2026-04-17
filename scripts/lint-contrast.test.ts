/**
 * lint-contrast モジュール群の単体テスト。
 *
 * classify.ts は未実装 (ユーザー設計判断の箇所) なので、
 * 各モジュールを独立して検証する構成にしている。
 *
 * テスト対象:
 * - parseCssVars: CSS 変数の抽出と HSLA → RGBA 変換
 * - resolveTailwind: Tailwind クラス → RGBA 解決
 * - composite: Porter-Duff アルファ合成
 * - evaluateContrast: WCAG 2.1 コントラスト比計算
 * - collectJsxStacks: JSX スタック抽出 (classify なし)
 *
 * classify.ts を使うエンドツーエンドテストは
 * classify.ts 実装後に追加すること。
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectJsxStacks } from './lib/contrast/collectJsxStacks';
import { compositeOver } from './lib/contrast/composite';
import {
  wcagContrastRatio,
  WCAG_AA_THRESHOLD,
  relativeLuminance,
} from './lib/contrast/evaluateContrast';
import { parseCssVars } from './lib/contrast/parseCssVars';
import { resolveClass } from './lib/contrast/resolveTailwind';
import type { Rgba } from './lib/contrast/types';

// Project root for resolving CSS path
const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);

// Helper: create a temporary CSS file with specified content
function createTempCss(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lint-contrast-'));
  const cssPath = path.join(dir, 'index.css');
  writeFileSync(cssPath, content, 'utf8');
  return cssPath;
}

// ============================================================
// parseCssVars
// ============================================================

describe('parseCssVars', () => {
  it('parses :root and .dark CSS variables from src/index.css', () => {
    const cssPath = path.join(PROJECT_ROOT, 'src', 'index.css');
    const vars = parseCssVars(cssPath);

    // Light mode: --background should be white (0 0% 100%)
    expect(vars.light['--background']).toBeDefined();
    const bg = vars.light['--background'];
    expect(bg).toBeDefined();
    // HSL(0, 0%, 100%) = white = rgb(1, 1, 1)
    expect(bg.r).toBeCloseTo(1, 2);
    expect(bg.g).toBeCloseTo(1, 2);
    expect(bg.b).toBeCloseTo(1, 2);
    expect(bg.a).toBeCloseTo(1, 2);

    // Dark mode: --foreground should be hsl(220, 15%, 85%)
    // culori: hsl(220 15% 85%) → rgb(0.8275, 0.8425, 0.8725)
    expect(vars.dark['--foreground']).toBeDefined();
    const fg = vars.dark['--foreground'];
    expect(fg.r).toBeCloseTo(0.8275, 2);
    expect(fg.g).toBeCloseTo(0.8425, 2);
    expect(fg.b).toBeCloseTo(0.8725, 2);
    expect(fg.a).toBeCloseTo(1, 2);
  });

  it('correctly parses HSL with alpha (e.g., --muted in dark mode)', () => {
    const cssPath = path.join(PROJECT_ROOT, 'src', 'index.css');
    const vars = parseCssVars(cssPath);

    // Dark --muted: 220 27% 12% / 0.4 → alpha should be 0.4
    const muted = vars.dark['--muted'];
    expect(muted).toBeDefined();
    expect(muted.a).toBeCloseTo(0.4, 2);
  });

  it('parses minimal CSS with only :root', () => {
    const css = `
      @layer base {
        :root {
          --background: 0 0% 100%;
          --foreground: 0 0% 9%;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    expect(vars.light['--background']).toBeDefined();
    expect(vars.light['--background'].r).toBeCloseTo(1, 2);
    expect(vars.light['--foreground'].r).toBeCloseTo(0.09, 2);
    // Dark vars should be empty for this minimal CSS
    expect(Object.keys(vars.dark)).toHaveLength(0);
  });

  it('handles :root and .dark in @layer base', () => {
    const css = `
      @layer base {
        :root {
          --card: 0 0% 100%;
        }
        .dark {
          --card: 220 27% 12% / 0.7;
        }
      }
    `;
    const cssPath = createTempCss(css);
    const vars = parseCssVars(cssPath);

    expect(vars.light['--card'].r).toBeCloseTo(1, 2);
    expect(vars.dark['--card'].a).toBeCloseTo(0.7, 2);
  });
});

// ============================================================
// compositeOver
// ============================================================

describe('compositeOver', () => {
  it('returns base when stack is empty', () => {
    const base: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    const result = compositeOver([], base);
    expect(result).toEqual(base);
  });

  it('returns opaque layer unchanged over any base', () => {
    const base: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const layer: Rgba = { r: 1, g: 0, b: 0, a: 1 }; // opaque red
    const result = compositeOver([layer], base);
    expect(result.r).toBeCloseTo(1, 5);
    expect(result.g).toBeCloseTo(0, 5);
    expect(result.b).toBeCloseTo(0, 5);
    expect(result.a).toBeCloseTo(1, 5);
  });

  it('composites semi-transparent white over black correctly', () => {
    // white/30 over black → 30% toward white from black
    const base: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const layer: Rgba = { r: 1, g: 1, b: 1, a: 0.3 };
    const result = compositeOver([layer], base);
    // ao = 0.3 + 1.0 * 0.7 = 1.0
    // r = (1*0.3 + 0*1*0.7) / 1.0 = 0.3
    expect(result.r).toBeCloseTo(0.3, 5);
    expect(result.g).toBeCloseTo(0.3, 5);
    expect(result.b).toBeCloseTo(0.3, 5);
    expect(result.a).toBeCloseTo(1, 5);
  });

  it('composites multiple layers from outermost to innermost', () => {
    // Stack: [outer_blue_50%, inner_red_50%] over white
    // First: outer_blue over white → blended
    // Then: inner_red over that blend
    const base: Rgba = { r: 1, g: 1, b: 1, a: 1 }; // white
    const outerBlue: Rgba = { r: 0, g: 0, b: 1, a: 0.5 };
    const innerRed: Rgba = { r: 1, g: 0, b: 0, a: 0.5 };

    const result = compositeOver([outerBlue, innerRed], base);
    // Step 1: blue/0.5 over white/1.0
    // ao = 0.5 + 0.5 = 1.0
    // r = (0*0.5 + 1*0.5) / 1.0 = 0.5
    // b = (1*0.5 + 1*0.5) / 1.0 = 1.0 → wait, base is white so b_base=1
    // Actually: ao = src.a + dst.a*(1-src.a) = 0.5 + 1.0*0.5 = 1.0
    // r = (0*0.5 + 1.0*1.0*0.5)/1.0 = 0.5
    // g = (0*0.5 + 1.0*1.0*0.5)/1.0 = 0.5
    // b = (1.0*0.5 + 1.0*1.0*0.5)/1.0 = 1.0
    // Step 2: red/0.5 over step1={0.5, 0.5, 1.0, 1.0}
    // ao = 0.5 + 1.0*0.5 = 1.0
    // r = (1.0*0.5 + 0.5*1.0*0.5)/1.0 = 0.75
    // g = (0*0.5 + 0.5*1.0*0.5)/1.0 = 0.25
    // b = (0*0.5 + 1.0*1.0*0.5)/1.0 = 0.5
    expect(result.r).toBeCloseTo(0.75, 4);
    expect(result.g).toBeCloseTo(0.25, 4);
    expect(result.b).toBeCloseTo(0.5, 4);
    expect(result.a).toBeCloseTo(1, 4);
  });

  it('handles both layers fully transparent', () => {
    const base: Rgba = { r: 0, g: 0, b: 0, a: 0 };
    const layer: Rgba = { r: 1, g: 1, b: 1, a: 0 };
    const result = compositeOver([layer], base);
    expect(result.a).toBeCloseTo(0, 5);
  });
});

// ============================================================
// wcagContrastRatio / relativeLuminance
// ============================================================

describe('evaluateContrast', () => {
  it('returns 21:1 for black on white', () => {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const white: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    const ratio = wcagContrastRatio(black, white);
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('returns 1:1 for same color', () => {
    const gray: Rgba = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
    const ratio = wcagContrastRatio(gray, gray);
    expect(ratio).toBeCloseTo(1, 5);
  });

  it('bg-background/text-foreground (light) passes AA', () => {
    // Light: background = hsl(0 0% 100%) = white, foreground = hsl(0 0% 9%)
    const bg: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    const fg: Rgba = { r: 0.09, g: 0.09, b: 0.09, a: 1 };
    const ratio = wcagContrastRatio(fg, bg);
    expect(ratio).toBeGreaterThan(WCAG_AA_THRESHOLD);
    // expected ~17.94
    expect(ratio).toBeGreaterThan(15);
  });

  it('bg-background/text-foreground (dark opaque) passes AA', () => {
    // Dark: background ≈ hsl(220 27% 8%) → rgb(0.0584, 0.0728, 0.1016)
    //       foreground ≈ hsl(220 15% 85%) → rgb(0.8275, 0.8425, 0.8725)
    const bg: Rgba = { r: 0.0584, g: 0.0728, b: 0.1016, a: 1 };
    const fg: Rgba = { r: 0.8275, g: 0.8425, b: 0.8725, a: 1 };
    const ratio = wcagContrastRatio(fg, bg);
    expect(ratio).toBeGreaterThan(WCAG_AA_THRESHOLD);
    // Expected ratio ≈ 12.92
    expect(ratio).toBeGreaterThan(10);
  });

  it('detects low contrast combination (dark 15% bg / 40% fg)', () => {
    // Custom ng-low-contrast-dark fixture values (opaque)
    // bg = hsl(0 0% 15%) ≈ rgb(0.15, 0.15, 0.15)
    // fg = hsl(0 0% 40%) ≈ rgb(0.40, 0.40, 0.40)
    const bg: Rgba = { r: 0.15, g: 0.15, b: 0.15, a: 1 };
    const fg: Rgba = { r: 0.4, g: 0.4, b: 0.4, a: 1 };
    const ratio = wcagContrastRatio(fg, bg);
    expect(ratio).toBeLessThan(WCAG_AA_THRESHOLD);
    // expected ~2.16
    expect(ratio).toBeLessThan(3);
  });

  it('WCAG_AA_THRESHOLD is 4.5', () => {
    expect(WCAG_AA_THRESHOLD).toBe(4.5);
  });

  it('relativeLuminance of white is 1.0', () => {
    const white: Rgba = { r: 1, g: 1, b: 1, a: 1 };
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
  });

  it('relativeLuminance of black is 0.0', () => {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
  });
});

// ============================================================
// resolveTailwind
// ============================================================

describe('resolveTailwind.resolveClass', () => {
  // Use src/index.css for real CSS vars
  const cssPath = path.join(PROJECT_ROOT, 'src', 'index.css');
  const cssVars = parseCssVars(cssPath);

  it('resolves bg-background to white in light mode', () => {
    const result = resolveClass('bg-background', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 2);
    expect(result!.g).toBeCloseTo(1, 2);
    expect(result!.b).toBeCloseTo(1, 2);
  });

  it('resolves text-foreground in dark mode', () => {
    const result = resolveClass('text-foreground', 'dark', cssVars);
    expect(result).not.toBeNull();
    // Dark foreground: hsl(220 15% 85%) → rgb(0.8275, 0.8425, 0.8725)
    expect(result!.r).toBeCloseTo(0.8275, 2);
  });

  it('resolves bg-card in light mode (semantic token via var)', () => {
    const result = resolveClass('bg-card', 'light', cssVars);
    expect(result).not.toBeNull();
    // Light card: hsl(0 0% 100%) = white
    expect(result!.r).toBeCloseTo(1, 2);
  });

  it('resolves bg-card in dark mode (semantic token with alpha)', () => {
    const result = resolveClass('bg-card', 'dark', cssVars);
    expect(result).not.toBeNull();
    // Dark card: hsl(220 27% 12% / 0.7) → alpha = 0.7
    expect(result!.a).toBeCloseTo(0.7, 2);
  });

  it('resolves opacity modifier: bg-white/30', () => {
    const result = resolveClass('bg-white/30', 'light', cssVars);
    expect(result).not.toBeNull();
    // white with 30% opacity
    expect(result!.r).toBeCloseTo(1, 2);
    expect(result!.a).toBeCloseTo(0.3, 2);
  });

  it('resolves opacity modifier: bg-white/80', () => {
    const result = resolveClass('bg-white/80', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.a).toBeCloseTo(0.8, 2);
  });

  it('returns null for non-color class (e.g., flex)', () => {
    const result = resolveClass('flex', 'light', cssVars);
    expect(result).toBeNull();
  });

  it('returns null for dark: prefix in light mode', () => {
    const result = resolveClass('dark:bg-card', 'light', cssVars);
    expect(result).toBeNull();
  });

  it('resolves dark: prefix in dark mode', () => {
    const result = resolveClass('dark:bg-card', 'dark', cssVars);
    expect(result).not.toBeNull();
  });

  it('resolves arbitrary hex value: bg-[#ff0000]', () => {
    const result = resolveClass('bg-[#ff0000]', 'light', cssVars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 2);
    expect(result!.g).toBeCloseTo(0, 2);
    expect(result!.b).toBeCloseTo(0, 2);
  });

  it('resolves text-muted-foreground in light mode', () => {
    const result = resolveClass('text-muted-foreground', 'light', cssVars);
    expect(result).not.toBeNull();
    // Light muted-foreground: hsl(0 0% 45%) ≈ gray
    expect(result!.r).toBeCloseTo(0.45, 2);
    expect(result!.g).toBeCloseTo(0.45, 2);
    expect(result!.b).toBeCloseTo(0.45, 2);
  });
});

// ============================================================
// collectJsxStacks
// ============================================================

describe('collectJsxStacks', () => {
  it('extracts bg+text stack from simple nesting', () => {
    const source = `
      export function Foo() {
        return (
          <div className="bg-card">
            <p className="text-foreground">hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    // The <p> element has text-foreground with bg-card as ancestor
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    expect(pStack!.bgStack.some((c) => c.classes.includes('bg-card'))).toBe(
      true,
    );
    expect(
      pStack!.textCandidates.some((c) => c.classes.includes('text-foreground')),
    ).toBe(true);
  });

  it('returns empty array when no text+bg nesting exists', () => {
    // ok-card-on-background.tsx style: no text on bg when there's no parent bg
    const source = `
      export function Foo() {
        return <p className="text-foreground">hello</p>;
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    // No bg ancestor, so no stacks
    expect(stacks).toHaveLength(0);
  });

  it('detects dynamic class as branchLabel: dynamic', () => {
    const source = `
      declare const x: string;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={\`text-foreground \${x}\`}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // The template literal has an expression, so it's dynamic
    // textCandidates should contain a dynamic entry
    const hasDynamic = pStack!.textCandidates.some(
      (c) => c.branchLabel === 'dynamic',
    );
    expect(hasDynamic).toBe(true);
  });

  it('ignores elements with no bg or text classes (skip-no-colors fixture)', () => {
    const source = readFileSync(
      path.join(
        PROJECT_ROOT,
        'scripts/test-fixtures/contrast/skip-no-colors.tsx',
      ),
      'utf8',
    );
    const stacks = collectJsxStacks('skip-no-colors.tsx', source);
    // No bg+text combination
    expect(stacks).toHaveLength(0);
  });

  it('extracts bg stack from ok-card-on-background fixture', () => {
    const source = readFileSync(
      path.join(
        PROJECT_ROOT,
        'scripts/test-fixtures/contrast/ok-card-on-background.tsx',
      ),
      'utf8',
    );
    const stacks = collectJsxStacks('ok-card-on-background.tsx', source);
    expect(stacks.length).toBeGreaterThan(0);
    // Should have at least one stack with bg-background and text-foreground
    const hasExpected = stacks.some(
      (s) =>
        s.bgStack.some((c) => c.classes.includes('bg-background')) &&
        s.textCandidates.some((c) => c.classes.includes('text-foreground')),
    );
    expect(hasExpected).toBe(true);
  });

  it('extracts nested alpha composite stack from ng-alpha-composite fixture', () => {
    const source = readFileSync(
      path.join(
        PROJECT_ROOT,
        'scripts/test-fixtures/contrast/ng-alpha-composite.tsx',
      ),
      'utf8',
    );
    const stacks = collectJsxStacks('ng-alpha-composite.tsx', source);
    expect(stacks.length).toBeGreaterThan(0);
    // The innermost <p> should have bg-background + bg-white/30 in its stack
    const innerStack = stacks.find(
      (s) =>
        s.bgStack.some((c) => c.classes.includes('bg-white/30')) &&
        s.elementName === 'p',
    );
    expect(innerStack).toBeDefined();
    expect(
      innerStack!.bgStack.some((c) => c.classes.includes('bg-background')),
    ).toBe(true);
  });

  it('handles cn() call with conditional class', () => {
    const source = `
      declare const cond: boolean;
      export function Foo() {
        return (
          <div className="bg-background">
            <p className={cn(cond && 'bg-card', 'text-foreground')}>hello</p>
          </div>
        );
      }
    `;
    const stacks = collectJsxStacks('test.tsx', source);
    const pStack = stacks.find((s) => s.elementName === 'p');
    expect(pStack).toBeDefined();
    // cn with conditional should produce a dynamic or conditional branch
    const hasBgBranch = pStack!.bgStack.some(
      (c) =>
        c.classes.includes('bg-card') || c.branchLabel?.includes('conditional'),
    );
    expect(hasBgBranch).toBe(true);
  });
});

// ============================================================
// Integration: full pipeline (without classify.ts)
// ============================================================

describe('Integration: parseCssVars → resolveTailwind → composite → evaluateContrast', () => {
  const cssPath = path.join(PROJECT_ROOT, 'src', 'index.css');
  const cssVars = parseCssVars(cssPath);

  it('ok-card-on-background: bg-background/text-foreground passes AA in both modes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const base = cssVars[theme]['--background'] ?? { r: 1, g: 1, b: 1, a: 1 };
      const bgRgba = resolveClass('bg-background', theme, cssVars);
      const fgRgba = resolveClass('text-foreground', theme, cssVars);

      expect(bgRgba).not.toBeNull();
      expect(fgRgba).not.toBeNull();

      const compositedBg = compositeOver([bgRgba!], base);
      const compositedFg = compositeOver([fgRgba!], compositedBg);
      const ratio = wcagContrastRatio(compositedFg, compositedBg);

      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
    }
  });

  it('ng-alpha-composite: bg-white/30 over dark base fails AA with 50% gray fg', () => {
    // Simulate: dark base = hsl(220 27% 8%) (opaque), then bg-white/30, then text at 50% L
    const darkBase = cssVars['dark']['--background'] ?? {
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    };
    // Force base to be opaque for this test
    const opaqueBase: Rgba = { ...darkBase, a: 1 };

    const bgWhite30 = resolveClass('bg-white/30', 'dark', cssVars);
    expect(bgWhite30).not.toBeNull();
    expect(bgWhite30!.a).toBeCloseTo(0.3, 2);

    const compositedBg = compositeOver([bgWhite30!], opaqueBase);

    // 50% gray text - should be similar luminance to the composited bg → low contrast
    const mediumGrayFg: Rgba = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
    const compositedFg = compositeOver([mediumGrayFg], compositedBg);
    const ratio = wcagContrastRatio(compositedFg, compositedBg);

    expect(ratio).toBeLessThan(WCAG_AA_THRESHOLD);
  });

  it('custom CSS vars: ng-low-contrast-dark fails in dark, passes in light', () => {
    // Custom CSS with values that fail in dark but pass in light
    const customCss = `
      @layer base {
        :root {
          --ng-bg: 0 0% 100%;
          --ng-fg: 0 0% 45%;
        }
        .dark {
          --ng-bg: 0 0% 15%;
          --ng-fg: 0 0% 40%;
        }
      }
    `;
    const cssPath = createTempCss(customCss);
    const customVars = parseCssVars(cssPath);

    const lightBg = customVars.light['--ng-bg'];
    const lightFg = customVars.light['--ng-fg'];
    const darkBg = customVars.dark['--ng-bg'];
    const darkFg = customVars.dark['--ng-fg'];

    const lightRatio = wcagContrastRatio(lightFg, lightBg);
    const darkRatio = wcagContrastRatio(darkFg, darkBg);

    // Light: hsl(0 0% 100%) / hsl(0 0% 45%) ≈ 4.76 → passes
    expect(lightRatio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);

    // Dark: hsl(0 0% 15%) / hsl(0 0% 40%) ≈ 2.16 → fails
    expect(darkRatio).toBeLessThan(WCAG_AA_THRESHOLD);
  });
});
