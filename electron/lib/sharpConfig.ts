/**
 * Sharp (libvips) の設定管理
 *
 * 大量の写真を処理する際のメモリ使用量を制御するための設定。
 *
 * ## 初期化
 *
 * - **早期初期化** (electron/index.ts)
 *   - GTK/libvips の GLib-GObject 競合を防ぐため、アプリ起動直後に実行
 *   - `sharp.concurrency(1); sharp.cache(false);` で最小設定
 *
 * - **アプリ内設定調整** (このモジュール)
 *   - `initializeSharp()` で写真処理に適した設定に調整
 *
 * ## 参考
 * - https://sharp.pixelplumbing.com/api-utility#concurrency
 * - https://sharp.pixelplumbing.com/api-utility#cache
 */

import sharp from 'sharp';

/**
 * loggerを遅延インポート（キャッシュ付き）
 *
 * sharpConfig.tsがloggerをトップレベルでインポートすると、
 * loggerが@sentry/electron/mainやelectron-logをインポートし、
 * それがGTKを読み込んでGLib-GObject競合を引き起こす。
 *
 * 遅延インポートにより、Sharp初期化後にのみloggerが読み込まれる。
 */
let lazyLogger: typeof import('./logger').logger | null = null;

const getLazyLogger = async () => {
  if (!lazyLogger) {
    const { logger } = await import('./logger');
    lazyLogger = logger;
  }
  return lazyLogger;
};

/**
 * Sharp設定オプション
 */
interface SharpConfigOptions {
  /**
   * libvipsのスレッド数
   * - 0: CPUコア数（デフォルト）
   * - 1: シングルスレッド（メモリ使用量最小）
   * - 2-4: 推奨範囲（バランス）
   */
  concurrency: number;

  /**
   * キャッシュ設定
   * - false: キャッシュ無効
   * - { memory, files, items }: 詳細設定
   */
  cache:
    | false
    | {
        /** メモリキャッシュ上限 (MB) */
        memory: number;
        /** ファイルキャッシュ数 */
        files: number;
        /** アイテムキャッシュ数 */
        items: number;
      };
}

/**
 * デフォルト設定（メモリ効率重視）
 *
 * - concurrency: 2（並列処理とメモリのバランス）
 * - cache: 制限付き（memory: 50MB, files: 10, items: 50）
 */
const DEFAULT_CONFIG: SharpConfigOptions = {
  concurrency: 2,
  cache: {
    memory: 50,
    files: 10,
    items: 50,
  },
};

let isInitialized = false;
let currentCacheConfig: SharpConfigOptions['cache'] = false;

/**
 * Sharpを初期化する
 *
 * 写真処理開始時に呼び出し、適切な設定に調整する。
 * electron/index.ts での早期初期化後に呼び出される。
 *
 * @param options 設定オプション（省略時はデフォルト設定）
 */
export const initializeSharp = (
  options: Partial<SharpConfigOptions> = {},
): void => {
  const config: SharpConfigOptions = {
    ...DEFAULT_CONFIG,
    ...options,
  };

  sharp.concurrency(config.concurrency);

  if (config.cache === false) {
    sharp.cache(false);
  } else {
    sharp.cache(config.cache);
  }

  currentCacheConfig = config.cache;
  isInitialized = true;

  // 非同期でログ出力（fire-and-forget）
  void getLazyLogger().then((l) =>
    l.info({
      message: 'Sharp initialized',
      details: {
        concurrency: sharp.concurrency(),
        cache: sharp.cache(),
        simd: sharp.simd(),
        platform: process.platform,
      },
    }),
  );
};

/**
 * 初期化済みかどうかを確認
 */
export const isSharpInitialized = (): boolean => {
  return isInitialized;
};

/**
 * Sharpのキャッシュをクリアする
 *
 * バッチ処理間でメモリを解放するために使用。
 * キャッシュクリア後、元の設定に戻る。
 */
export const clearSharpCache = (): void => {
  sharp.cache(false);

  if (currentCacheConfig !== false) {
    sharp.cache(currentCacheConfig);
  }

  void getLazyLogger().then((l) => l.debug('Sharp cache cleared'));
};
