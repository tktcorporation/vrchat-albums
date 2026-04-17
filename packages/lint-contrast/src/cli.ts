/**
 * lint-contrast CLI ロジック。
 *
 * bin/lint-contrast.ts から呼ばれる。
 * このモジュールはランナーとして argv を受け取り、
 * 対象ファイルをスキャンしてコントラスト違反を報告する。
 *
 * 終了コード:
 * - 0: エラーなし (warning のみは 0)
 * - 1: コントラスト比 AA 未満のエラーあり
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import consola from 'consola';
import { glob } from 'glob';

import { classifyStack } from './classify.js';
import { collectJsxStacks } from './collectJsxStacks.js';
import { wcagContrastRatio } from './evaluateContrast.js';
import { parseCssVars } from './parseCssVars.js';
import type { ContrastIssue, JsxStack, Rgba, Theme } from './types.js';

// ---------------------------------------------------------------------------
// CLI オプション
// ---------------------------------------------------------------------------

interface CliOptions {
  /** 対象プロジェクトのルート */
  project: string;
  /** 走査対象 glob パターン */
  glob: string;
  /** CSS 変数定義ファイル (プロジェクトルートからの相対パス) */
  css: string;
  /** WCAG AA 閾値 */
  threshold: number;
  /** 出力形式 */
  format: 'text' | 'json';
  /** unknown を error に昇格するか */
  warnAsError: boolean;
}

/**
 * process.argv を解析して CliOptions を返す。
 *
 * サポートオプション:
 *   --project <path>   対象プロジェクトのルート (default: cwd)
 *   --glob <pattern>   走査対象 glob (default: "src/**\/*.tsx")
 *   --css <path>       CSS 変数定義ファイル (default: "src/index.css")
 *   --threshold <n>    AA 閾値 (default: 4.5)
 *   --format <fmt>     出力形式: text|json (default: text)
 *   --warn-as-error    unknown を error に昇格
 *   --help             ヘルプ表示
 */
function parseArgs(argv: string[]): CliOptions | null {
  const args = argv.slice(2); // skip 'node' and script path

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: lint-contrast [options]

Options:
  --project <path>     対象プロジェクトのルート (default: cwd)
  --glob <pattern>     走査対象 glob (default: "src/**/*.tsx")
  --css <path>         CSS 変数定義ファイル (default: "src/index.css")
  --threshold <n>      AA 閾値 (default: 4.5)
  --format <fmt>       出力形式: text|json (default: text)
  --warn-as-error      unknown を error に昇格
  --help               ヘルプ表示
`);
    return null;
  }

  const opts: CliOptions = {
    project: process.cwd(),
    glob: 'src/**/*.tsx',
    css: 'src/index.css',
    threshold: 4.5,
    format: 'text',
    warnAsError: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--project' && args[i + 1]) {
      opts.project = args[++i];
    } else if (arg === '--glob' && args[i + 1]) {
      opts.glob = args[++i];
    } else if (arg === '--css' && args[i + 1]) {
      opts.css = args[++i];
    } else if (arg === '--threshold' && args[i + 1]) {
      const n = parseFloat(args[++i]);
      if (!isNaN(n)) {
        opts.threshold = n;
      }
    } else if (arg === '--format' && args[i + 1]) {
      const fmt = args[++i];
      if (fmt === 'json' || fmt === 'text') {
        opts.format = fmt;
      }
    } else if (arg === '--warn-as-error') {
      opts.warnAsError = true;
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// コントラスト評価ロジック
// ---------------------------------------------------------------------------

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
 * 単一の JsxStack を評価してコントラスト違反を生成する。
 *
 * classifyStack が 'resolvable' を返した場合のみコントラスト計算を行う。
 * 'unknown' は warning, 'skip' は報告なし。
 */
function evaluateStack(
  stack: JsxStack,
  cssVars: Record<Theme, Record<string, Rgba>>,
  opts: CliOptions,
): ContrastIssue[] {
  const resolution = classifyStack(stack, cssVars);
  const issues: ContrastIssue[] = [];

  if (resolution.kind === 'skip') {
    return [];
  }

  if (resolution.kind === 'unknown') {
    const severity = opts.warnAsError ? 'error' : 'warning';
    issues.push({
      file: stack.file,
      line: stack.line,
      column: stack.column,
      severity,
      theme: 'both',
      message: `[contrast] Cannot resolve color classes for <${stack.elementName}>: ${resolution.reason}`,
    });
    return issues;
  }

  // resolvable: compute contrast for both themes using pre-computed worst-case pairs
  const themes: Theme[] = ['light', 'dark'];
  for (const theme of themes) {
    const themeData = resolution.themes[theme];
    const ratio = wcagContrastRatio(themeData.fg, themeData.bg);

    if (ratio < opts.threshold) {
      issues.push({
        file: stack.file,
        line: stack.line,
        column: stack.column,
        severity: 'error',
        theme,
        ratio,
        message: `[contrast] <${stack.elementName}> contrast ratio ${ratio.toFixed(2)} < ${opts.threshold} (WCAG AA) in ${theme} mode`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// JSON 出力
// ---------------------------------------------------------------------------

interface JsonReport {
  errorCount: number;
  warningCount: number;
  issues: ContrastIssue[];
}

function reportJson(issues: ContrastIssue[], projectRoot: string): JsonReport {
  const report: JsonReport = {
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    issues: issues.map((i) => ({
      ...i,
      file: path.relative(projectRoot, i.file),
    })),
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function reportText(issues: ContrastIssue[], projectRoot: string): void {
  for (const issue of issues) {
    const relative = path.relative(projectRoot, issue.file);
    const ratioStr =
      issue.ratio === null || issue.ratio === undefined
        ? ''
        : ` (ratio: ${issue.ratio.toFixed(2)})`;
    const icon = issue.severity === 'error' ? 'x' : '!';
    console.log(
      `[${icon}] ${relative}:${issue.line}:${issue.column} [${issue.theme}]${ratioStr} ${issue.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

/**
 * CLI エントリポイント。
 *
 * @param argv - process.argv を渡す
 */
export async function runCli(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  if (opts === null) {
    // --help が表示済み
    process.exit(0);
  }

  const projectRoot = path.resolve(opts.project);
  consola.start(`Running lint-contrast on ${projectRoot}...`);

  // 1. Load CSS variables
  const cssPath = path.join(projectRoot, opts.css);
  const cssVars = parseCssVars(cssPath);

  // 2. Build base backgrounds for use in getBaseBackground (available via closure)
  // Attach to cssVars wrapper for use in evaluateStack
  const cssVarsWithBase = cssVars;

  // Also expose getBaseBackground for resolving base per theme
  // (used internally in classifyStack via cssVars parameter)
  // Make light/dark bases available for classifyStack via cssVars['--background']
  for (const theme of ['light', 'dark'] as const) {
    if (!cssVarsWithBase[theme]['--background']) {
      cssVarsWithBase[theme]['--background'] = getBaseBackground(
        cssVars,
        theme,
      );
    }
  }

  // 3. Find all TSX files
  const files = await glob([opts.glob], {
    cwd: projectRoot,
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

  // 4. Process each file
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const stacks = collectJsxStacks(file, source);

    for (const stack of stacks) {
      const issues = evaluateStack(stack, cssVarsWithBase, opts);
      allIssues.push(...issues);
    }
  }

  // 5. Report results
  if (allIssues.length === 0) {
    consola.success('No contrast issues found.');
    process.exit(0);
  }

  const errors = allIssues.filter((i) => i.severity === 'error');
  const warnings = allIssues.filter((i) => i.severity === 'warning');

  consola.info(
    `Found ${errors.length} error(s) and ${warnings.length} warning(s):`,
  );

  if (opts.format === 'json') {
    reportJson(allIssues, projectRoot);
  } else {
    reportText(allIssues, projectRoot);
  }

  // Exit 1 only on errors; warnings are informational (Strategy B)
  if (errors.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}
