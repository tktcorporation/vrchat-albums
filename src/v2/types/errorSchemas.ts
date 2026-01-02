import { z } from 'zod';
import { ERROR_CATEGORIES, ERROR_CODES } from './errorConstants';

/**
 * 構造化エラー情報のスキーマ
 */
export const StructuredErrorSchema = z.object({
  code: z.nativeEnum(ERROR_CODES),
  category: z.nativeEnum(ERROR_CATEGORIES),
  userMessage: z.string(),
});

/**
 * tRPCエラーのデータ部分のスキーマ
 */
export const TRPCErrorDataSchema = z.object({
  structuredError: StructuredErrorSchema.optional(),
  originalError: z
    .object({
      name: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
});

/**
 * tRPC v10のエラー構造（直接dataプロパティ）
 */
export const DirectDataErrorSchema = z.object({
  data: TRPCErrorDataSchema,
});

/**
 * tRPC v10のエラー構造（shape.data）
 */
export const ShapeDataErrorSchema = z.object({
  shape: z.object({
    data: TRPCErrorDataSchema,
  }),
});

/**
 * tRPC v10のエラー構造（shape.json.data）
 */
export const ShapeJsonDataErrorSchema = z.object({
  shape: z.object({
    json: z.object({
      data: TRPCErrorDataSchema,
    }),
  }),
});

/**
 * tRPC v11のエラー構造（cause.data）
 * v11ではエラーがcauseプロパティにラップされている場合がある
 */
export const CauseDataErrorSchema = z.object({
  cause: z.object({
    data: TRPCErrorDataSchema,
  }),
});

/**
 * エラーオブジェクトから構造化エラー情報を安全に抽出
 */
export function extractStructuredError(error: unknown) {
  // DirectDataパターンを試行
  const directDataResult = DirectDataErrorSchema.safeParse(error);
  if (directDataResult.success) {
    return directDataResult.data.data.structuredError;
  }

  // ShapeDataパターンを試行
  const shapeDataResult = ShapeDataErrorSchema.safeParse(error);
  if (shapeDataResult.success) {
    return shapeDataResult.data.shape.data.structuredError;
  }

  // ShapeJsonDataパターンを試行
  const shapeJsonDataResult = ShapeJsonDataErrorSchema.safeParse(error);
  if (shapeJsonDataResult.success) {
    return shapeJsonDataResult.data.shape.json.data.structuredError;
  }

  // tRPC v11のcauseパターンを試行
  const causeDataResult = CauseDataErrorSchema.safeParse(error);
  if (causeDataResult.success) {
    return causeDataResult.data.cause.data.structuredError;
  }

  // 柔軟なパターン: 任意の深さでstructuredErrorを探す
  if (error && typeof error === 'object') {
    const findStructuredError = (obj: unknown, depth = 0): unknown => {
      if (depth > 5 || !obj || typeof obj !== 'object') return undefined;
      const record = obj as Record<string, unknown>;
      if ('structuredError' in record && record.structuredError) {
        const result = StructuredErrorSchema.safeParse(record.structuredError);
        if (result.success) return result.data;
      }
      for (const value of Object.values(record)) {
        const found = findStructuredError(value, depth + 1);
        if (found) return found;
      }
      return undefined;
    };
    const found = findStructuredError(error);
    if (found) {
      return found as z.infer<typeof StructuredErrorSchema>;
    }
  }

  return undefined;
}
