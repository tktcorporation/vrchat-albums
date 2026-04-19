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
import { getBaseBackground } from './getBaseBackground.js';
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
  /** 除外する glob パターンのリスト */
  ignore: string[];
  /** 組合せ爆発の上限 */
  maxCombinations: number;
}

/**
 * parseArgs の戻り値型。
 *
 * warnings は scoped logger 作成前に検出された警告メッセージのリスト。
 * parseArgs が直接 consola.warn を呼ぶと、JSON モードでも scoped logger が
 * まだ存在しないためグローバルな consola が stdout に出力してしまい
 * `jq` 等のパイプが壊れる。そのため parseArgs は警告を蓄積して返し、
 * runCli 側で scoped logger 経由で出力する。
 */
interface ParseArgsResult {
  opts: CliOptions;
  warnings: string[];
}

/**
 * process.argv を解析して ParseArgsResult を返す。
 *
 * サポートオプション:
 *   --project <path>         対象プロジェクトのルート (default: cwd)
 *   --glob <pattern>         走査対象 glob (default: "src/**\/*.tsx")
 *   --css <path>             CSS 変数定義ファイル (default: "src/index.css")
 *   --threshold <n>          AA 閾値 (default: 4.5)
 *   --format <fmt>           出力形式: text|json (default: text)
 *   --warn-as-error          unknown を error に昇格
 *   --ignore <pattern>       除外 glob パターン (複数指定可)
 *   --max-combinations <n>   組合せ爆発の上限 (default: 32)
 *   --help                   ヘルプ表示
 */
function parseArgs(argv: string[]): ParseArgsResult | null {
  const args = argv.slice(2); // skip 'node' and script path

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: lint-contrast [options]

Options:
  --project <path>         対象プロジェクトのルート (default: cwd)
  --glob <pattern>         走査対象 glob (default: "src/**/*.tsx")
  --css <path>             CSS 変数定義ファイル (default: "src/index.css")
  --threshold <n>          AA 閾値 (default: 4.5)
  --format <fmt>           出力形式: text|json (default: text)
  --warn-as-error          unknown を error に昇格
  --ignore <pattern>       除外 glob パターン (複数指定可)
  --max-combinations <n>   組合せ爆発の上限 (default: 32)
  --help                   ヘルプ表示
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
    // デフォルトは node_modules とテストファイルのみ除外。
    // test-fixtures は意図的に含める (ドッグフーディング用)。
    ignore: ['**/node_modules/**', '**/*.test.tsx', '**/*.spec.tsx'],
    maxCombinations: 32,
  };

  // scoped logger 作成前に検出した警告を蓄積する。
  // consola.warn を直接呼ぶと JSON モードでも stdout を汚染するため、
  // runCli 側で scoped logger が確定してから出力する。
  const warnings: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--project' && args[i + 1]) {
      opts.project = args[++i];
    } else if (arg === '--glob' && args[i + 1]) {
      opts.glob = args[++i];
    } else if (arg === '--css' && args[i + 1]) {
      opts.css = args[++i];
    } else if (arg === '--threshold' && args[i + 1]) {
      const rawThreshold = args[++i];
      const n = parseFloat(rawThreshold);
      if (Number.isNaN(n)) {
        // 無効な数値はデフォルトを維持し、警告を蓄積する。
        // 直接 consola.warn を呼ばないのは、この時点では scoped logger が
        // まだ作られておらず、JSON モードでも stdout に出力されてしまうため。
        warnings.push(
          `Ignoring invalid value for --threshold: ${rawThreshold}`,
        );
      } else {
        opts.threshold = n;
      }
    } else if (arg === '--format' && args[i + 1]) {
      const fmt = args[++i];
      if (fmt === 'json' || fmt === 'text') {
        opts.format = fmt;
      } else {
        // --threshold と同じパターン: scoped logger 準備前に蓄積し、後で出力する。
        warnings.push(
          `Ignoring invalid value for --format: ${fmt} (valid: json, text)`,
        );
      }
    } else if (arg === '--warn-as-error') {
      opts.warnAsError = true;
    } else if (arg === '--ignore' && args[i + 1]) {
      opts.ignore.push(args[++i]);
    } else if (arg === '--max-combinations' && args[i + 1]) {
      const rawCombinations = args[++i];
      const n = parseInt(rawCombinations, 10);
      if (!Number.isNaN(n) && n > 0 && Number.isInteger(n)) {
        opts.maxCombinations = n;
      } else {
        // --threshold と同じパターン: scoped logger 準備前に蓄積し、後で出力する。
        warnings.push(
          `Ignoring invalid value for --max-combinations: ${rawCombinations} (must be a positive integer)`,
        );
      }
    }
  }

  return { opts, warnings };
}

// ---------------------------------------------------------------------------
// Inline ignore directive
// ---------------------------------------------------------------------------

/**
 * `lint-contrast-disable` マーカー (next-line バリアント以外) を検出する正規表現。
 *
 * `-next-line` サフィックスを含む形式は `lines.includes('lint-contrast-disable-next-line')`
 * で直接検出するため、この定数は「同一行ディレクティブ」専用。
 *
 * JSX 内では `//` コメントが書けないため、`{/* ... *\/}` 形式もサポートする。
 * そのため単純に行テキストにマーカー文字列が含まれるかでチェックする。
 */
const DIRECTIVE_DISABLE = /lint-contrast-disable\b(?!-next-line)/;

/**
 * 複数行 JSX/ブロックコメントの終端を検出する正規表現。
 *
 * `*\/` または `*\/}` が行末までのいずれかの位置で終わるパターン。
 * 本文が英字で始まる中継行を誤ってコメントでないと判定しないよう、
 * ブロックコメントは行単位の開閉状態で追跡する。
 */
const BLOCK_COMMENT_END_PATTERN = /\*\/\}?\s*$/;

/**
 * 各行が「コメント/空白のみで構成されているか」を表すフラグ配列を計算する。
 *
 * `isDisabledByDirective` から呼ばれる前処理。複数行の JSX コメント
 * (`{/* ... *\/}`) やブロックコメント (`/* ... *\/`) の中継行（英字で
 * 始まる本文のみの行）も正しくコメントと判定するため、行ベースで開閉状態を追跡する。
 *
 * 文字列リテラル中に `/*` を含むといった病的ケースは扱わない。
 * JSX コメントの実用パターンをカバーすれば十分という判断。
 */
function computeCommentLineFlags(lines: readonly string[]): boolean[] {
  const flags: boolean[] = Array.from({ length: lines.length }, () => false);
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inBlockComment) {
      flags[i] = true;
      if (BLOCK_COMMENT_END_PATTERN.test(trimmed)) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed === '') {
      flags[i] = true;
      continue;
    }

    if (trimmed.startsWith('//')) {
      flags[i] = true;
      continue;
    }

    if (trimmed.startsWith('{/*') || trimmed.startsWith('/*')) {
      flags[i] = true;
      if (!BLOCK_COMMENT_END_PATTERN.test(trimmed)) {
        inBlockComment = true;
      }
    }
  }

  return flags;
}

/**
 * 指定行のコントラスト検査を ignore ディレクティブが無効化しているか判定する。
 *
 * 以下のどちらかを満たすと true を返す:
 * - 対象行自体に `lint-contrast-disable` マーカーがある
 *   （例: `<p className="..."> {/* lint-contrast-disable *\/} </p>`）
 * - 対象行より前方の連続するコメント/空白行群のいずれかに
 *   `lint-contrast-disable-next-line` マーカーがある
 *   （directive の直後に補足説明コメントを挟んでも効かせるため、
 *    コード行に当たるまで遡って探索する）
 *
 * 非テキスト要素 (アイコン、progress indicator) や linter が解釈できない
 * グラデーション背景上のテキストなど、擬陽性を抑制するために使用する。
 *
 * @param lines - ソースを改行で分割した配列
 * @param lineNumber - 1-indexed の行番号（JsxStack.line と同じ形式）
 */
function isDisabledByDirective(
  lines: readonly string[],
  commentFlags: readonly boolean[],
  lineNumber: number,
): boolean {
  if (lineNumber <= 0 || lineNumber > lines.length) {
    return false;
  }

  const targetLine = lines[lineNumber - 1];
  if (DIRECTIVE_DISABLE.test(targetLine)) {
    return true;
  }

  // 対象行より前を遡り、連続するコメント/空白行の中に directive があれば有効。
  // コード行に到達したら停止する（関係のない箇所の directive を拾わないため）。
  for (let i = lineNumber - 2; i >= 0; i--) {
    if (!commentFlags[i]) {
      return false;
    }
    if (lines[i].includes('lint-contrast-disable-next-line')) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// コントラスト評価ロジック
// ---------------------------------------------------------------------------

/**
 * WCAG 1.4.11 (非テキスト UI コンポーネント) の閾値。
 *
 * アイコン・グラフィック・状態インジケーター等は「隣接色と 3:1 以上」で
 * AA 適合となるため、本文テキスト基準 (4.5) より緩い閾値を適用する。
 * ref: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
 */
const WCAG_NON_TEXT_THRESHOLD = 3;

/**
 * 単一の JsxStack を評価してコントラスト違反を生成する。
 *
 * classifyStack が 'resolvable' を返した場合のみコントラスト計算を行う。
 * 'unknown' は warning, 'skip' は報告なし。
 * 非テキスト UI コンポーネント (アイコン、SVG primitives) には 3:1 基準を適用する。
 * グラデーション背景は静的に単色として解けないため skip 扱い。
 */
function evaluateStack(
  stack: JsxStack,
  cssVars: Record<Theme, Record<string, Rgba>>,
  opts: CliOptions,
): ContrastIssue[] {
  // グラデーション背景の要素は linter が正確に色を解けないため skip。
  // 擬陽性 (from-black/60 上の text-white を「白地白文字」と誤判定) を防ぐ。
  if (stack.hasGradientBackground) {
    return [];
  }

  const resolution = classifyStack(stack, cssVars, opts.maxCombinations);
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

  // 非テキスト要素は WCAG 1.4.11 の 3:1 基準、テキスト要素は AA 4.5:1 (opts.threshold) を適用。
  const elementThreshold = stack.isNonTextElement
    ? WCAG_NON_TEXT_THRESHOLD
    : opts.threshold;
  const criterionLabel = stack.isNonTextElement
    ? 'WCAG 1.4.11 non-text'
    : 'WCAG AA';

  // resolvable: compute contrast for both themes using pre-computed worst-case pairs
  const themes: Theme[] = ['light', 'dark'];
  for (const theme of themes) {
    const themeData = resolution.themes[theme];
    const ratio = wcagContrastRatio(themeData.fg, themeData.bg);

    if (ratio < elementThreshold) {
      issues.push({
        file: stack.file,
        line: stack.line,
        column: stack.column,
        severity: 'error',
        theme,
        ratio,
        message: `[contrast] <${stack.elementName}> contrast ratio ${ratio.toFixed(2)} < ${elementThreshold} (${criterionLabel}) in ${theme} mode`,
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
 * exit code を戻り値で返す。bin/lint-contrast.ts 側で process.exit() する。
 * これにより テスト等からも呼び出せる (process.exit() を直接呼ばない)。
 *
 * @param argv - process.argv を渡す
 * @returns exit code (0: 成功, 1: エラーあり)
 */
export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed === null) {
    // --help が表示済み
    return 0;
  }

  const { opts, warnings: parseWarnings } = parsed;

  // JSON モードでは stdout を pure JSON に保つため、
  // consola の status ログ (start / info / success / warn) を無効化する。
  // グローバルな consola.level を変更すると他のモジュールに副作用が生じるため、
  // scoped logger (consola.create) を使用してグローバル状態を汚染しない。
  // 下流ツール (jq 等) が consola のステータス行で JSON パース失敗するのを防ぐ。
  const logger =
    opts.format === 'json' ? consola.create({ level: -999 }) : consola;

  // parseArgs が蓄積した警告を scoped logger 経由で出力する。
  // JSON モードでは level=-999 により抑制されるため stdout を汚染しない。
  // text モードでは通常通り警告が表示される。
  for (const w of parseWarnings) {
    logger.warn(w);
  }

  const projectRoot = path.resolve(opts.project);
  logger.start(`Running lint-contrast on ${projectRoot}...`);

  // 1. Load CSS variables
  // path.resolve は絶対パス指定 (--css /abs/path/to/index.css) を正しく扱う。
  // path.join では絶対パスが projectRoot に連結されてしまい壊れる (F2 修正)。
  const cssPath = path.resolve(projectRoot, opts.css);
  const cssVars = parseCssVars(cssPath);

  // 2. --background を実効色に正規化する。
  // alpha < 1 の場合は警告を出し不透明実効色に変換する (I5 対応)。
  // cssVars を直接変異させる (clone 不要: parseCssVars は呼び出しごとに新オブジェクト)。
  const themes: readonly Theme[] = ['light', 'dark'];
  const alphaWarnCallback = (t: Theme, a: number): void => {
    logger.warn(
      `[contrast] --background in ${t} has alpha=${a.toFixed(3)} < 1. ` +
        `Using composited value over ${t === 'light' ? 'white' : 'black'} as effective base.`,
    );
  };
  for (const theme of themes) {
    cssVars[theme]['--background'] = getBaseBackground(
      cssVars,
      theme,
      alphaWarnCallback,
    );
  }

  // 3. Find all TSX files
  const files = await glob([opts.glob], {
    cwd: projectRoot,
    absolute: true,
    ignore: opts.ignore,
  });

  logger.info(`Found ${files.length} TSX files to check`);

  const allIssues: ContrastIssue[] = [];

  // 4. Process each file
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const stacks = collectJsxStacks(file, source);
    const sourceLines = source.split('\n');
    const commentFlags = computeCommentLineFlags(sourceLines);

    for (const stack of stacks) {
      if (isDisabledByDirective(sourceLines, commentFlags, stack.line)) {
        continue;
      }
      const issues = evaluateStack(stack, cssVars, opts);
      allIssues.push(...issues);
    }
  }

  // 5. Report results
  const errors = allIssues.filter((i) => i.severity === 'error');
  const warnings = allIssues.filter((i) => i.severity === 'warning');

  if (allIssues.length === 0) {
    // JSON モードでは違反ゼロの場合も parseable な JSON を出力する。
    // 下流ツール (jq 等) は常に JSON ペイロードを期待するため、
    // 空ケースのために特別扱いが必要にならないよう一貫した出力を提供する。
    if (opts.format === 'json') {
      reportJson(allIssues, projectRoot);
    } else {
      logger.success('No contrast issues found.');
    }
    return 0;
  }

  logger.info(
    `Found ${errors.length} error(s) and ${warnings.length} warning(s):`,
  );

  if (opts.format === 'json') {
    reportJson(allIssues, projectRoot);
  } else {
    reportText(allIssues, projectRoot);
  }

  // Exit 1 only on errors; warnings are informational (Strategy B)
  return errors.length > 0 ? 1 : 0;
}
