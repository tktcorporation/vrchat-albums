/**
 * 環境判定ユーティリティ
 *
 * アプリケーション全体で使用する環境判定関数を提供する。
 * 重複定義を避け、一貫した判定ロジックを保証する。
 */

/**
 * Linux プラットフォームかどうかを判定
 *
 * ## 用途
 * - GLib-GObject競合を避けるためのSharp設定調整
 *   （GTKとlibvipsが同じGLib-GObjectを使用するため、Linux環境では競合が発生しうる）
 *
 * ## 注意
 * テスト環境か本番環境かではなく、プラットフォームで判定する。
 * これにより、テスト環境と本番環境で同じコードパスを通ることを保証する。
 *
 * @returns process.platform が 'linux' の場合 true
 */
export const isLinuxPlatform = (): boolean => {
  return process.platform === 'linux';
};

/**
 * 開発環境かどうかを判定
 *
 * @returns NODE_ENV が 'development' または app.isPackaged が false の場合 true
 */
export const isDevelopment = (): boolean => {
  return process.env.NODE_ENV === 'development';
};

/**
 * テスト環境かどうかを判定（Vitest/Jest）
 *
 * @returns NODE_ENV が 'test' の場合 true
 */
export const isTestEnvironment = (): boolean => {
  return process.env.NODE_ENV === 'test';
};
