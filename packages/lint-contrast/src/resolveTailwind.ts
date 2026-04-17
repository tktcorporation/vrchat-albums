/**
 * Tailwind クラス名を RGBA 色に解決するモジュール。
 *
 * 解決優先順位:
 * 1. セマンティックトークン: "bg-card" → CSS 変数 "--card" を parseCssVars のマップから引く
 *    (tailwind.config.js で hsl(var(--card)) と定義されているものが対象)
 * 2. 既知の基本色: "bg-white" → rgb(1,1,1), "bg-black" → rgb(0,0,0)
 * 3. 任意値: "bg-[#abcdef]", "bg-[hsl(0_0%_50%)]" → 直接パース
 * 4. opacity modifier: "bg-white/80" → alpha 0.8 を付与
 * 5. dark: プレフィックス → ダークテーマ時のみ適用 (ライトテーマでは null)
 *
 * 設計判断:
 * tailwindcss v4 では resolveConfig が公開 API から削除されたため、
 * CSS 変数名とクラス名サフィックスの対応を直接マッピングする。
 * このプロジェクトでは hsl(var(--xxx)) 形式のセマンティックトークンのみ使用する (規約)。
 * 対応関係: bg-{suffix} → CSS var "--{suffix}" (例: bg-card → --card)
 */

import * as culori from 'culori';

import type { Rgba, Theme } from './types';

/**
 * culori でパース可能な色文字列を RGBA に変換する。
 * 変換失敗の場合は null を返す。
 */
function culoriToRgba(colorStr: string): Rgba | null {
  const parsed = culori.rgb(culori.parse(colorStr));
  if (!parsed) {
    return null;
  }
  return {
    r: Math.max(0, Math.min(1, parsed.r ?? 0)),
    g: Math.max(0, Math.min(1, parsed.g ?? 0)),
    b: Math.max(0, Math.min(1, parsed.b ?? 0)),
    a: Math.max(0, Math.min(1, parsed.alpha ?? 1)),
  };
}

/**
 * 任意値クラス "[#abcdef]" や "[hsl(0_0%_50%)]" を RGBA に変換する。
 *
 * Tailwind の任意値では "_" がスペースに変換される。
 */
function parseArbitraryValue(value: string): Rgba | null {
  // Replace underscores with spaces (Tailwind arbitrary value convention)
  const normalized = value.replaceAll('_', ' ');
  return culoriToRgba(normalized);
}

/**
 * Tailwind クラスを CSS 値に解決する。
 *
 * セマンティックトークン解決の仕組み:
 * このプロジェクトの tailwind.config.js では、セマンティックカラーは
 * すべて `hsl(var(--{suffix}))` 形式で定義されている。
 * そのため、クラス名サフィックス = CSS 変数名の "--" 以降の部分 という
 * 単純な対応関係が成立する。
 *
 * 例: bg-card → CSS var "--card", text-muted-foreground → "--muted-foreground"
 *
 * - セマンティックトークン (`bg-card`) → `--card` を cssVars[theme] から引く
 * - 既知の基本色 (`bg-white`, `bg-black`) → culori で直接パース
 * - 任意値 (`bg-[#abcdef]`, `bg-[hsl(0_0%_50%)]`) → 直接パース
 * - opacity modifier (`bg-white/80`) → alpha 0.8 を付与
 * - dark: プレフィックス → ダークテーマ時のみ適用
 *
 * 解決不能 (未定義変数、動的値) の場合は null。
 *
 * @param cls - Tailwind クラス名 (例: "bg-card", "text-muted-foreground", "bg-white/80")
 * @param theme - 解決するテーマ ('light' | 'dark')
 * @param cssVars - parseCssVars が返した CSS 変数マップ
 * @returns 解決された RGBA 値、解決不能な場合は null
 */
export function resolveClass(
  cls: string,
  theme: Theme,
  cssVars: Record<Theme, Record<string, Rgba>>,
): Rgba | null {
  let remaining = cls;

  // Handle dark: prefix - only applies in dark theme
  if (remaining.startsWith('dark:')) {
    if (theme !== 'dark') {
      return null;
    } // not applicable in light theme
    remaining = remaining.slice(5);
  }

  // Strip Tailwind important modifier "!" (e.g. "!text-foreground" → "text-foreground").
  // collectJsxStacks の extractBase が "!" を剥がして color class 判定するが、
  // ClassCandidate.classes には元形式 ("!text-foreground") のまま格納される。
  // variant 剥がし (dark:) の直後に剥がすことで、"dark:!bg-card" にも対応する。
  if (remaining.startsWith('!')) {
    remaining = remaining.slice(1);
  }

  // Determine if this is a bg or text class
  let prefix: 'bg' | 'text' | null = null;
  if (remaining.startsWith('bg-')) {
    prefix = 'bg';
    remaining = remaining.slice(3);
  } else if (remaining.startsWith('text-')) {
    prefix = 'text';
    remaining = remaining.slice(5);
  }

  if (!prefix) {
    return null;
  }

  // Handle opacity modifier and arbitrary values.
  //
  // 処理順序が重要 — 任意値クラス (例: bg-[hsl(220_15%_85%/0.5)]) は
  // ブラケット内に "/" を含む場合がある。先に "/" で split すると
  // "[hsl(220_15%_85%" と "0.5)]" に分断されて任意値パースが失敗する。
  // そのため **ブラケット任意値を先に検出** し、ブラケット外の "/" のみを
  // opacity modifier として解釈する。
  //
  // サポートするパターン:
  //   bg-[hsl(220_15%_85%/0.5)]      → ブラケット内の "/" は色値の一部
  //   bg-[hsl(220_15%_85%/0.5)]/80   → ブラケット外の "/80" が opacity override
  //   bg-[#abcdef]/50                 → ブラケット外の "/50" が opacity override
  //   bg-white/80                     → 通常の opacity modifier (ブラケットなし)

  let opacityOverride: number | null = null;
  let rgba: Rgba | null = null;

  if (remaining.startsWith('[')) {
    // ブラケット任意値: "[value]" または "[value]/opacity"
    // remaining = "[value]" か "[value]/nn" の形式 (prefix "bg-"/"text-" は既に削除済み)
    const bracketEnd = remaining.lastIndexOf(']');
    if (bracketEnd !== -1) {
      const innerValue = remaining.slice(1, bracketEnd);
      const afterBracket = remaining.slice(bracketEnd + 1); // "]" より後 (空文字 or "/nn")
      if (afterBracket.startsWith('/')) {
        const opacityStr = afterBracket.slice(1);
        const opacityNum = parseFloat(opacityStr);
        if (!Number.isNaN(opacityNum)) {
          // Tailwind opacity: 小数点を含む場合 (e.g. "/0.5") は decimal として使用し、
          // 整数表記 (e.g. "/1", "/50", "/100") は percentage として /100 する。
          // "/1" は 1% = 0.01 (ほぼ透明) であり、1.0 (不透明) ではない。
          // 範囲外値 (e.g. "/200", "/-50") は [0, 1] にクランプする (F3 修正)。
          const raw = opacityStr.includes('.') ? opacityNum : opacityNum / 100;
          opacityOverride = Math.max(0, Math.min(1, raw));
        }
      }
      rgba = parseArbitraryValue(innerValue);
    }
  } else {
    // 通常のクラス: opacity modifier は "/" で split して取り出す
    // ブラケット任意値ではないので "/" はここでのみ出現する
    const slashIdx = remaining.indexOf('/');
    if (slashIdx !== -1) {
      const opacityStr = remaining.slice(slashIdx + 1);
      remaining = remaining.slice(0, slashIdx);
      const opacityNum = parseFloat(opacityStr);
      if (!Number.isNaN(opacityNum)) {
        // Tailwind opacity: 小数点を含む場合 (e.g. "/0.5") は decimal として使用し、
        // 整数表記 (e.g. "/1", "/80", "/100") は percentage として /100 する。
        // "/1" は 1% = 0.01 (ほぼ透明) であり、1.0 (不透明) ではない。
        // 範囲外値 (e.g. "/200", "/-50") は [0, 1] にクランプする (F3 修正)。
        const raw = opacityStr.includes('.') ? opacityNum : opacityNum / 100;
        opacityOverride = Math.max(0, Math.min(1, raw));
      }
    }
  }

  if (rgba === null) {
    // Strategy: suffix → CSS var name "--{suffix}" (semantic token convention)
    // bg-card → --card, text-muted-foreground → --muted-foreground
    const cssVarName = `--${remaining}`;
    const fromCssVars = cssVars[theme][cssVarName];
    // Fallback: try culori direct parse for known color names
    // (e.g., "white", "black", "transparent", hex values)
    rgba = fromCssVars ?? culoriToRgba(remaining);
  }

  if (rgba === null) {
    return null;
  }

  // Apply opacity override if present
  if (opacityOverride !== null) {
    return { ...rgba, a: opacityOverride };
  }

  return rgba;
}
