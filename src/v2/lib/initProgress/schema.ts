/**
 * 初期化処理の進捗報告用zodスキーマ（フロントエンド用）
 * electron/module/initProgress/schema.ts と同期
 *
 * Note: electronとsrcは別ビルドのため、型定義を共有できない。
 * このファイルはelectron側のスキーマと同一の定義を保持する。
 */
import { z } from 'zod';

/**
 * 初期化処理のステージ
 */
export const InitStageSchema = z.enum([
  'database_sync',
  'directory_check',
  'log_append',
  'log_load',
  'photo_index',
  'completed',
]);
export type InitStage = z.infer<typeof InitStageSchema>;

/**
 * 進捗の詳細情報
 */
export const InitProgressDetailsSchema = z
  .object({
    current: z.number().int().min(0).optional(),
    total: z.number().int().min(0).optional(),
    currentItem: z.string().optional(),
  })
  .strict();
export type InitProgressDetails = z.infer<typeof InitProgressDetailsSchema>;

/**
 * 初期化進捗イベントのペイロード
 */
export const InitProgressPayloadSchema = z
  .object({
    stage: InitStageSchema,
    progress: z.number().int().min(0).max(100),
    message: z.string().min(1),
    details: InitProgressDetailsSchema.optional(),
  })
  .strict();
export type InitProgressPayload = z.infer<typeof InitProgressPayloadSchema>;

/**
 * ステージの日本語ラベル
 */
export const STAGE_LABELS: Record<InitStage, string> = {
  database_sync: 'データベース初期化',
  directory_check: 'ディレクトリ確認',
  log_append: 'ログファイル読み込み',
  log_load: 'ログデータ保存',
  photo_index: '写真インデックス',
  completed: '完了',
} as const;

/**
 * safeParse の戻り値型
 */
export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/**
 * 進捗ペイロードを検証する
 * @param data 検証するデータ
 * @returns パース結果
 */
export const parseInitProgressPayload = (
  data: unknown,
): SafeParseResult<InitProgressPayload> => {
  return InitProgressPayloadSchema.safeParse(
    data,
  ) as SafeParseResult<InitProgressPayload>;
};
