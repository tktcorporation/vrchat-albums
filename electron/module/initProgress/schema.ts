/**
 * 初期化処理の進捗報告用zodスキーマ
 * 型定義の一元管理とランタイム検証を提供
 */
import { z } from 'zod';

/**
 * 初期化処理のステージ
 */
export const InitStageSchema = z.enum([
  'ready', // subscription接続完了
  'database_sync',
  'directory_check',
  'log_append',
  'log_load',
  'photo_index',
  'completed',
  'error',
]);
export type InitStage = z.infer<typeof InitStageSchema>;

/**
 * 進捗の詳細情報
 */
export const InitProgressDetailsSchema = z
  .object({
    /** 処理済み件数 */
    current: z.number().int().min(0).optional(),
    /** 総件数 */
    total: z.number().int().min(0).optional(),
    /** 現在処理中のファイル名など */
    currentItem: z.string().optional(),
  })
  .strict();
export type InitProgressDetails = z.infer<typeof InitProgressDetailsSchema>;

/**
 * 初期化進捗イベントのペイロード
 */
export const InitProgressPayloadSchema = z
  .object({
    /** 現在のステージ */
    stage: InitStageSchema,
    /** ステージ内での進捗（0-100） */
    progress: z.number().int().min(0).max(100),
    /** ユーザー向けメッセージ */
    message: z.string().min(1),
    /** 詳細情報（オプション） */
    details: InitProgressDetailsSchema.optional(),
  })
  .strict();
export type InitProgressPayload = z.infer<typeof InitProgressPayloadSchema>;

/**
 * IPCチャンネル名（定数として型安全に管理）
 */
export const INIT_PROGRESS_CHANNEL = 'init-progress' as const;
export type InitProgressChannel = typeof INIT_PROGRESS_CHANNEL;

/**
 * ステージの日本語ラベル
 */
export const STAGE_LABELS: Record<InitStage, string> = {
  ready: '接続完了',
  database_sync: 'データベース初期化',
  directory_check: 'ディレクトリ確認',
  log_append: 'ログファイル読み込み',
  log_load: 'ログデータ保存',
  photo_index: '写真インデックス',
  completed: '完了',
  error: 'エラー',
} as const;
