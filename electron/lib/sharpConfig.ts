/**
 * 画像処理エンジンの初期化管理
 *
 * napi-rs/image (Rust製) を使用。
 * sharp (libvips) と異なり、キャッシュや並行性の設定APIは不要。
 * GTK/libvips の GLib-GObject 競合問題も発生しない。
 *
 * ## 背景
 * sharp から @napi-rs/image への移行により、以下が不要になった:
 * - electron/index.ts での早期初期化（GLib-GObject 競合回避）
 * - concurrency / cache の手動設定
 *
 * この薄いラッパーは、既存コードの initializeSharp() / clearSharpCache() /
 * isSharpInitialized() 呼び出しとの互換性を維持するために残している。
 * 将来的に呼び出し元が不要と判断されれば削除可能。
 */

let isInitialized = false;

/**
 * 画像処理エンジンを初期化する
 *
 * napi-rs/image はステートレスなため、初期化フラグの設定のみ行う。
 */
export const initializeSharp = (): void => {
  isInitialized = true;
};

/**
 * 初期化済みかどうかを確認
 */
export const isSharpInitialized = (): boolean => {
  return isInitialized;
};

/**
 * キャッシュクリア（互換性のためのno-op）
 *
 * napi-rs/image にはグローバルキャッシュがないため何もしない。
 * 呼び出し元がこの関数を使わなくなれば削除可能。
 */
export const clearSharpCache = (): void => {
  // no-op: @napi-rs/image has no global cache to clear
};
