#!/usr/bin/env node

/**
 * lint-contrast: デザインシステムのコントラスト静的検証スクリプト。
 *
 * JSX の親子ネストから背景色スタックを構築し、
 * Tailwind クラス → CSS 変数 → RGBA を解決して
 * WCAG 2.1 AA コントラスト比 (>= 4.5) を検証する。
 *
 * 実行: pnpm lint:contrast
 *
 * 終了コード:
 * - 0: エラーなし (warning のみは 0)
 * - 1: コントラスト比 AA 未満のエラーあり (resolvable かつ AA 未満)
 *
 * classify.ts が未実装の場合は実行時エラーになる (設計意図)。
 * classify.ts を実装してから本スクリプトを実際の lint に使用すること。
 *
 * 参考: issues/20260417-design-system-contrast-lint.md
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import consola from 'consola';
import { glob } from 'glob';

import { classifyStack } from './lib/contrast/classify';
import { collectJsxStacks } from './lib/contrast/collectJsxStacks';
import { compositeOver } from './lib/contrast/composite';
import {
  wcagContrastRatio,
  WCAG_AA_THRESHOLD,
} from './lib/contrast/evaluateContrast';
import { parseCssVars } from './lib/contrast/parseCssVars';
import { resolveClass } from './lib/contrast/resolveTailwind';
import type {
  ContrastIssue,
  JsxStack,
  Rgba,
  Theme,
} from './lib/contrast/types';

/** プロジェクトルートの絶対パス */
const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);

/**
 * CSS 変数マップからベース背景色 (--background) を取得する。
 *
 * --background は最外層の下に仮定するベース色として使用する。
 * 未定義の場合は白 (light) または黒 (dark) を返す。
 */
function getBaseBackground(
  cssVars: Record<Theme, Record<string, Rgba>>,
  theme: Theme,
): Rgba {
  return (
    cssVars[theme]['--background'] ??
    (theme === 'light'
      ? { r: 1, g: 1, b: 1, a: 1 }
      : { r: 0, g: 0, b: 0, a: 1 })
  );
}

/**
 * 単一テーマに対して bg スタックと fg を解決し、コントラスト比を計算する。
 *
 * @param stack - JsxStack (bgStack と textCandidates を持つ)
 * @param theme - 計算対象テーマ
 * @param cssVars - CSS 変数マップ
 * @returns コントラスト比, または null (解決不能の場合)
 */
function computeContrastForTheme(
  bgClasses: string[],
  fgClasses: string[],
  theme: Theme,
  cssVars: Record<Theme, Record<string, Rgba>>,
): number | null {
  const base = getBaseBackground(cssVars, theme);

  // Resolve each bg class to RGBA
  const bgRgbas: Rgba[] = [];
  for (const cls of bgClasses) {
    const rgba = resolveClass(cls, theme, cssVars);
    if (rgba === null) {
      return null;
    } // Cannot resolve
    bgRgbas.push(rgba);
  }

  // Resolve fg class
  let fgRgba: Rgba | null = null;
  for (const cls of fgClasses) {
    const resolved = resolveClass(cls, theme, cssVars);
    if (resolved !== null) {
      fgRgba = resolved;
      break;
    }
  }
  if (fgRgba === null) {
    return null;
  }

  // Composite bg stack over base background
  const compositedBg = compositeOver(bgRgbas, base);

  // Composite fg over the composited bg (to handle semi-transparent text)
  const compositedFg = compositeOver([fgRgba], compositedBg);

  return wcagContrastRatio(compositedFg, compositedBg);
}

/**
 * 単一の JsxStack を評価してコントラスト違反を生成する。
 *
 * classifyStack が 'resolvable' を返した場合のみコントラスト計算を行う。
 * 'unknown' は warning, 'skip' は報告なし。
 */
function evaluateStack(
  stack: JsxStack,
  _cssVars: Record<Theme, Record<string, Rgba>>,
): ContrastIssue[] {
  const resolution = classifyStack(stack);
  const issues: ContrastIssue[] = [];

  if (resolution.kind === 'skip') {
    return [];
  }

  if (resolution.kind === 'unknown') {
    issues.push({
      file: stack.file,
      line: stack.line,
      column: stack.column,
      severity: 'warning',
      theme: 'both',
      message: `[contrast] Cannot resolve color classes for <${stack.elementName}>: ${resolution.reason}`,
    });
    return issues;
  }

  // resolvable: compute contrast for both themes
  const themes: Theme[] = ['light', 'dark'];
  for (const theme of themes) {
    const themeData = resolution.themes[theme];
    const ratio = wcagContrastRatio(themeData.fg, themeData.bg);

    if (ratio < WCAG_AA_THRESHOLD) {
      issues.push({
        file: stack.file,
        line: stack.line,
        column: stack.column,
        severity: 'error',
        theme,
        ratio,
        message: `[contrast] <${stack.elementName}> contrast ratio ${ratio.toFixed(2)} < ${WCAG_AA_THRESHOLD} (WCAG AA) in ${theme} mode`,
      });
    }
  }

  return issues;
}

/**
 * メイン処理: TSX ファイルを走査してコントラスト違反を報告する。
 *
 * classify.ts が未実装の場合は実行時エラーになる (意図的)。
 * テスト時は pnpm test scripts/lint-contrast.test.ts を使用すること。
 */
async function main(): Promise<void> {
  consola.start('Running lint-contrast...');

  // 1. Load CSS variables
  const cssPath = path.join(PROJECT_ROOT, 'src', 'index.css');
  const cssVars = parseCssVars(cssPath);

  // 2. Find all TSX files
  const files = await glob(['src/**/*.tsx'], {
    cwd: PROJECT_ROOT,
    absolute: true,
    ignore: [
      '**/node_modules/**',
      '**/*.test.tsx',
      '**/*.spec.tsx',
      '**/test-fixtures/**',
    ],
  });

  consola.info(`Found ${files.length} TSX files to check`);

  const allIssues: ContrastIssue[] = [];

  // 3. Process each file
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const stacks = collectJsxStacks(file, source);

    for (const stack of stacks) {
      // evaluateStack will call classifyStack which throws if not implemented
      const issues = evaluateStack(stack, cssVars);
      allIssues.push(...issues);
    }
  }

  // 4. Report results
  if (allIssues.length === 0) {
    consola.success('No contrast issues found.');
    process.exit(0);
  }

  const errors = allIssues.filter((i) => i.severity === 'error');
  const warnings = allIssues.filter((i) => i.severity === 'warning');

  consola.info(
    `Found ${errors.length} error(s) and ${warnings.length} warning(s):`,
  );

  for (const issue of allIssues) {
    const relative = path.relative(PROJECT_ROOT, issue.file);
    const ratioStr =
      issue.ratio === null || issue.ratio === undefined
        ? ''
        : ` (ratio: ${issue.ratio.toFixed(2)})`;
    const icon = issue.severity === 'error' ? 'x' : '!';
    console.log(
      `[${icon}] ${relative}:${issue.line}:${issue.column} [${issue.theme}]${ratioStr} ${issue.message}`,
    );
  }

  // Exit 1 only on errors; warnings are informational
  if (errors.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

// Only run main if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Note: classifyStack will throw "not implemented" at runtime.
  // This is by design - implement classify.ts before using this script.
  main().catch((error: unknown) => {
    consola.error('lint-contrast failed:', error);
    process.exit(1);
  });
}

// Export utilities for use from other modules / tests
export { computeContrastForTheme, getBaseBackground };
