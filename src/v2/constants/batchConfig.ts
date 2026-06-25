import { MAX_SESSION_BATCH_SIZE } from '../../../electron/constants/batchConfig';

/**
 * バッチ処理の設定定数（フロントエンド）
 */
export const BATCH_CONFIG = {
  /**
   * セッション情報バッチ取得の最大件数。
   * tRPC 検証上限と同一の単一ソース（electron/constants/batchConfig.ts）を参照する。
   */
  MAX_SESSION_BATCH_SIZE,

  /**
   * バッチ処理のウィンドウ時間（ミリ秒）。フロント専用。
   * 高速スクロール時のIPC負荷を軽減するため、スクロールが安定するまで待機。
   */
  BATCH_DELAY_MS: 300,

  /**
   * 重複リクエストとみなす時間閾値（ミリ秒）。フロント専用。
   */
  DUPLICATE_THRESHOLD_MS: 1000,
} as const;
