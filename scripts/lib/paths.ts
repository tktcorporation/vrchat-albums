import { normalize } from 'pathe';
import { z } from 'zod';

/**
 * 正規化されたパス文字列のブランド型
 * TypeScript コンパイラと互換性のあるフォワードスラッシュ形式
 */
export type NormalizedPath = string & { readonly __brand: 'NormalizedPath' };

/**
 * パスを正規化する Zod スキーマ
 * - バックスラッシュをフォワードスラッシュに変換
 * - 冗長なスラッシュを除去
 */
export const NormalizedPathSchema = z
  .string()
  .transform((val): NormalizedPath => {
    return normalize(val) as NormalizedPath;
  });

/**
 * パス配列を正規化する Zod スキーマ
 */
export const NormalizedPathArraySchema = z
  .array(z.string())
  .transform((paths): NormalizedPath[] => {
    return paths.map((p) => normalize(p) as NormalizedPath);
  });

/**
 * 正規化されたパスかどうかを判定
 */
export const isNormalizedPath = (p: string): p is NormalizedPath => {
  return !p.includes('\\');
};
