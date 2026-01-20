/**
 * 環境判定ユーティリティ
 *
 * プラットフォーム固有の動作を制御するための関数を提供する。
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
