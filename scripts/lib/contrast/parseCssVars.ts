/**
 * CSS 変数パーサ。
 *
 * src/index.css の :root (light) と .dark (dark) セレクタから
 * CSS カスタムプロパティ (--xxx) を抽出し、
 * HSL → RGBA マップに変換して返す。
 *
 * 対応フォーマット:
 * - "0 0% 100%"          → HSL 値 (alpha なし)
 * - "0 0% 100% / 0.9"    → HSLA 値 (alpha あり)
 *
 * culori の parse() に "hsl(" プレフィックスを付けて渡すことで
 * W3C Level 4 書式をパースする。
 */

import { readFileSync } from 'node:fs';

import * as culori from 'culori';
import postcss from 'postcss';

import type { Rgba, Theme } from './types';

/**
 * CSS 変数値文字列が HSL 形式かどうかを判定する。
 *
 * "0 0% 100%", "220 27% 8% / 0.05" のような形式を対象とする。
 * box-shadow や rgba() など非 HSL の値を除外するための pre-check。
 */
function looksLikeHslValue(value: string): boolean {
  // HSL format: number followed by number% number% optionally followed by / alpha
  // Quick check: should not contain 'px', 'rgba(', 'rgb(', 'calc('
  const trimmed = value.trim();
  if (
    trimmed.includes('px') ||
    trimmed.includes('rgba(') ||
    trimmed.includes('rgb(') ||
    trimmed.includes('calc(') ||
    trimmed.includes('rem') ||
    trimmed.startsWith('#')
  ) {
    return false;
  }
  // Must look like: "N N% N%" pattern (with optional "/ A")
  return /^\d[\d.]*\s+[\d.]+%\s+[\d.]+%/.test(trimmed);
}

/**
 * CSS 変数値文字列を RGBA に変換する。
 *
 * "0 0% 100%" や "220 27% 8% / 0.05" 形式に対応。
 * 解決できない場合は null を返す。
 */
function parseHslValue(value: string): Rgba | null {
  const trimmed = value.trim();

  // Pre-check: skip values that clearly aren't HSL
  if (!looksLikeHslValue(trimmed)) {
    return null;
  }

  // CSS vars store HSL as "H S% L%" or "H S% L% / A" without "hsl(" prefix
  let parsed: ReturnType<typeof culori.parse>;
  try {
    parsed = culori.parse(`hsl(${trimmed})`);
  } catch {
    return null;
  }

  if (!parsed) {
    return null;
  }
  const rgb = culori.rgb(parsed);
  if (!rgb) {
    return null;
  }
  return {
    r: Math.max(0, Math.min(1, rgb.r ?? 0)),
    g: Math.max(0, Math.min(1, rgb.g ?? 0)),
    b: Math.max(0, Math.min(1, rgb.b ?? 0)),
    a: Math.max(0, Math.min(1, rgb.alpha ?? 1)),
  };
}

/**
 * PostCSS ノードから CSS カスタムプロパティを抽出する。
 *
 * 対象セレクタ内の Declaration で "--" 始まりのプロパティを収集する。
 * "value: H S% L% / A" 形式の HSL をパースして RGBA マップに追加する。
 * パースできない値 (非 HSL 文字列等) はスキップする。
 */
function extractVarsFromRule(
  rule: postcss.Rule,
  target: Record<string, Rgba>,
): void {
  rule.walkDecls(/^--/, (decl) => {
    const rgba = parseHslValue(decl.value);
    if (rgba !== null) {
      target[decl.prop] = rgba;
    }
  });
}

/**
 * src/index.css をパースして :root (light) と .dark (dark) の
 * CSS 変数を RGBA マップに展開する。
 *
 * 削除条件: このモジュールは index.css の CSS 変数体系が
 * 廃止されるか、別のメカニズムに移行した場合に削除可能。
 *
 * @param cssPath - 解析対象の CSS ファイルの絶対パス (通常 src/index.css)
 * @returns ライト/ダーク両テーマの CSS 変数名 → RGBA マップ
 */
export function parseCssVars(
  cssPath: string,
): Record<Theme, Record<string, Rgba>> {
  const css = readFileSync(cssPath, 'utf8');
  const root = postcss.parse(css);

  const light: Record<string, Rgba> = {};
  const dark: Record<string, Rgba> = {};

  root.walkRules((rule) => {
    // :root selector maps to light theme
    if (rule.selector.trim() === ':root') {
      extractVarsFromRule(rule, light);
    } else if (rule.selector.trim() === '.dark') {
      // .dark selector maps to dark theme
      // Also matches "@layer base { .dark { ... } }" nesting via walkRules
      extractVarsFromRule(rule, dark);
    }
  });

  return { light, dark };
}
