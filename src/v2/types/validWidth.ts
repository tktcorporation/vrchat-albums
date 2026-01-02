import { z } from 'zod';

/**
 * 有効なコンテナ幅を表す Branded Type
 *
 * 0 以下の値は型レベルで排除される。
 * これにより、レイアウト計算コードでの防御的チェックが不要になる。
 *
 * ## 使用例
 *
 * ```typescript
 * const width = toValidWidth(1200);
 * if (width !== null) {
 *   // width は ValidWidth 型（常に > 0）
 *   calculator.calculateLayout(photos, width);
 * }
 * ```
 */
export const ValidWidthSchema = z
  .number()
  .positive('Width must be greater than 0')
  .brand<'ValidWidth'>();

export type ValidWidth = z.infer<typeof ValidWidthSchema>;

/**
 * 数値から ValidWidth を生成
 *
 * @param width - 変換する幅
 * @returns 有効な場合は ValidWidth、無効な場合は null
 */
export function toValidWidth(width: number): ValidWidth | null {
  const result = ValidWidthSchema.safeParse(width);
  return result.success ? result.data : null;
}
