/**
 * Porter-Duff "over" アルファ合成モジュール。
 *
 * 背景色スタックを外側から内側の順に合成し、単一の RGBA 値を返す。
 * WCAG コントラスト計算は完全不透明な色を前提とするため、
 * 半透明レイヤーを合成して実効色を求める必要がある。
 *
 * 合成順序: stack[0] (最外層) が base の上に乗り、
 *           stack[1] が stack[0] 合成結果の上に乗る、という順。
 */

import type { Rgba } from './types';

/**
 * Porter-Duff "over" 演算で2色を合成する。
 *
 * src が dst の上に乗る場合の合成。
 *
 * 合成式:
 *   out.a   = src.a + dst.a * (1 - src.a)
 *   out.rgb = (src.rgb * src.a + dst.rgb * dst.a * (1 - src.a)) / out.a
 *
 * out.a が 0 の場合 (両方完全透明) は黒透明を返す。
 */
function over(src: Rgba, dst: Rgba): Rgba {
  const ao = src.a + dst.a * (1 - src.a);
  if (ao === 0) {
    // 両方完全透明の場合: dst をそのまま返す (idempotent)
    return dst;
  }
  return {
    r: (src.r * src.a + dst.r * dst.a * (1 - src.a)) / ao,
    g: (src.g * src.a + dst.g * dst.a * (1 - src.a)) / ao,
    b: (src.b * src.a + dst.b * dst.a * (1 - src.a)) / ao,
    a: ao,
  };
}

/**
 * Porter-Duff "over" 合成で RGBA スタックを単一 RGBA に畳み込む。
 *
 * 外側から内側の順で stack が与えられる。最外層の下には
 * base (ライトモードでは白、ダークモードでは黒に近い色) を仮定する。
 * base は parseCssVars で解決した --background を使用することを推奨する。
 *
 * @param stack - bg クラスを外側から内側の順に並べた RGBA 配列
 * @param base - スタック最外層の下にあるベース色 (通常は --background の RGBA)
 * @returns 合成された単一の RGBA 値
 */
export function compositeOver(stack: Rgba[], base: Rgba): Rgba {
  // Start from the base (bottommost layer)
  let result = base;

  // Apply each layer from outermost (stack[0]) to innermost (stack[last])
  // Each layer is composited "over" the current accumulated result
  for (const layer of stack) {
    result = over(layer, result);
  }

  return result;
}
