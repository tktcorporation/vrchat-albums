/**
 * 初期化処理の進捗報告用型定義
 */

/**
 * 初期化処理のステージ
 */
export type InitStage =
  | 'database_sync'
  | 'directory_check'
  | 'log_append'
  | 'log_load'
  | 'photo_index'
  | 'completed';

/**
 * 初期化進捗イベントのペイロード
 */
export interface InitProgressPayload {
  /** 現在のステージ */
  stage: InitStage;
  /** ステージ内での進捗（0-100） */
  progress: number;
  /** ユーザー向けメッセージ */
  message: string;
  /** 詳細情報（オプション） */
  details?: {
    /** 処理済み件数 */
    current?: number;
    /** 総件数 */
    total?: number;
    /** 現在処理中のファイル名など */
    currentItem?: string;
  };
}

/**
 * IPCチャンネル名
 */
export const INIT_PROGRESS_CHANNEL = 'init-progress';
