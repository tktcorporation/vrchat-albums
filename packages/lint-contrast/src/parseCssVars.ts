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
  // culori.parse は無効入力に対して null/undefined を返す (throw しない)
  const parsed = culori.parse(`hsl(${trimmed})`);

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
  // dark マップは light (= :root) の全変数を継承した上で、
  // .dark セレクタ内の宣言で上書きする。
  // CSS カスタムプロパティは宣言階層を通じて継承されるため、
  // .dark 内で再定義されていない変数は :root の値が使われる。
  // 先に light を走査してから dark を初期化するために 2 パス構成にする。
  const darkOverrides: Record<string, Rgba> = {};

  root.walkRules((rule) => {
    // @media / @supports 内のルールは条件付き定義であり、
    // light/dark マップに無条件で混入させると誤ったコントラスト評価になる。
    // @layer や @root などの構造的 at-rule は通す (条件分岐ではないため)。
    // 将来 darkMode: 'media' を使う場合は別途設計が必要。
    if (rule.parent?.type === 'atrule') {
      const parentAtRule = rule.parent as postcss.AtRule;
      if (parentAtRule.name === 'media' || parentAtRule.name === 'supports') {
        return; // skip: 条件付き at-rule 内のルールは処理しない
      }
    }

    // :root selector maps to light theme
    if (rule.selector.trim() === ':root') {
      extractVarsFromRule(rule, light);
    } else if (rule.selector.trim() === '.dark') {
      // .dark selector maps to dark theme
      // Also matches "@layer base { .dark { ... } }" nesting via walkRules
      extractVarsFromRule(rule, darkOverrides);
    }
  });

  // :root の全変数を継承した上で、.dark 宣言で上書き
  const dark: Record<string, Rgba> = { ...light, ...darkOverrides };

  return { light, dark };
}
