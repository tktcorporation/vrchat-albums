/**
 * バッチ処理の設定定数
 */
export const BATCH_CONFIG = {
  /**
   * セッション情報バッチ取得の最大件数
   * tRPCのバリデーションとフロントエンドのバッチマネージャーで共通使用
   */
  MAX_SESSION_BATCH_SIZE: 100,

  /**
   * バッチ処理のウィンドウ時間（ミリ秒）
   * 高速スクロール時のIPC負荷を軽減するため、スクロールが安定するまで待機
   */
  BATCH_DELAY_MS: 300,

  /**
   * 重複リクエストとみなす時間閾値（ミリ秒）
   */
  DUPLICATE_THRESHOLD_MS: 1000,
} as const;
