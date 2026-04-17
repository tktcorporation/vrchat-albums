/**
 * ベース背景色 (--background) を取得する共有ヘルパー。
 *
 * CSS 変数マップから --background を解決してベース色を返す。
 * classify.ts と cli.ts の両方から使用する。
 *
 * --background の alpha が 1 未満の場合は不透明 fallback
 * (light=白, dark=黒) の上に Porter-Duff over で合成した実効色を返す。
 */

import { compositeOver } from './composite.js';
import type { Rgba, Theme } from './types.js';

/**
 * CSS 変数マップからベース背景色 (--background) を取得する。
 *
 * @param cssVars - parseCssVars が返した CSS 変数マップ
 * @param theme - 取得するテーマ ('light' | 'dark')
 * @param onAlphaWarn - alpha < 1 の場合に呼ばれる警告コールバック (省略可)
 * @returns ベース背景色 (不透明保証済み)
 */
export function getBaseBackground(
  cssVars: Record<Theme, Record<string, Rgba>>,
  theme: Theme,
  onAlphaWarn?: (theme: Theme, alpha: number) => void,
): Rgba {
  const opaqueBase: Rgba =
    theme === 'light' ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };

  const bg = cssVars[theme]['--background'];
  if (!bg) {
    return opaqueBase;
  }

  if (bg.a < 1) {
    // alpha < 1 の --background はコントラスト計算の基準として不適切。
    // 不透明 fallback (light=白, dark=黒) の上に Porter-Duff over で合成した
    // 実効色をベースとして使用する。
    onAlphaWarn?.(theme, bg.a);
    return compositeOver([bg], opaqueBase);
  }

  return bg;
}
