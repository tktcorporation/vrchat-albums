/**
 * WCAG 2.1 コントラスト比計算モジュール。
 *
 * WCAG 2.1 の相対輝度 (relative luminance) と
 * コントラスト比 (contrast ratio) の計算を提供する。
 *
 * 閾値:
 * - >= 4.5: AA (通常テキスト)
 * - >= 3.0: AA Large (大きなテキスト / 太字)
 * - >= 7.0: AAA (通常テキスト、強化基準)
 *
 * このモジュールは Phase 1 では AA (4.5) のみを使用する。
 * APCA (WCAG 3 ドラフト) は Phase 2 で追加検討。
 */

import type { Rgba } from './types';

/**
 * sRGB チャンネル値を線形 RGB (リニア光) に変換する。
 *
 * IEC 61966-2-1 の sRGB → 線形 RGB 変換。
 * WCAG 2.1 の相対輝度計算で必要。
 */
function toLinear(channel: number): number {
  // Clamp to [0, 1] to guard against floating-point rounding errors
  const c = Math.max(0, Math.min(1, channel));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * RGBA から WCAG 2.1 相対輝度 (relative luminance) を計算する。
 *
 * 半透明の場合はアルファを考慮せずに計算する。
 * 事前に compositeOver で実効色を求めてから渡すこと。
 *
 * 計算式: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * (R, G, B は線形 RGB)
 */
export function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * toLinear(color.r) +
    0.7152 * toLinear(color.g) +
    0.0722 * toLinear(color.b)
  );
}

/**
 * WCAG 2.1 の相対輝度比を計算する。
 *
 * ratio >= 4.5 で AA (通常テキスト), >= 3.0 で AA Large。
 *
 * 半透明テキストが背景に乗る場合は、事前に同じ compositeOver で
 * 実効 fg を計算してから渡す。
 *
 * @param fg - 前景色 (テキスト) の RGBA
 * @param bg - 背景色の RGBA
 * @returns コントラスト比 (1.0 〜 21.0)
 */
export function wcagContrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.1 AA 通常テキストのコントラスト比閾値 */
export const WCAG_AA_THRESHOLD = 4.5;

/** WCAG 2.1 AA 大テキスト (18pt以上 / 14pt以上太字) のコントラスト比閾値 */
export const WCAG_AA_LARGE_THRESHOLD = 3;
