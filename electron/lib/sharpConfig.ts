/**
 * Sharp (libvips) の初期化設定
 *
 * 大量の写真を処理する際のメモリ使用量を制御するための設定。
 * アプリケーション起動時に一度だけ呼び出す。
 *
 * ## 設定項目
 * - concurrency: libvipsのスレッド数（デフォルト: CPUコア数）
 * - cache: 操作キャッシュのサイズ制限
 *
 * ## 参考
 * - https://sharp.pixelplumbing.com/api-utility#concurrency
 * - https://sharp.pixelplumbing.com/api-utility#cache
 */

import sharp from 'sharp';
import { logger } from './logger';

/**
 * Sharp設定オプション
 */
export interface SharpConfigOptions {
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

/**
 * 初回起動・大量処理用の低メモリ設定
 *
 * - concurrency: 1（シングルスレッド）
 * - cache: 無効（メモリ使用量最小化）
 */
export const LOW_MEMORY_CONFIG: SharpConfigOptions = {
  concurrency: 1,
  cache: false,
};

let isInitialized = false;
let currentConfig: SharpConfigOptions = DEFAULT_CONFIG;

/**
 * Playwright/テスト環境かどうかを判定
 * GLib-GObject競合を避けるため、テスト環境では常に低メモリモードを使用
 */
const isPlaywrightTestEnvironment = (): boolean => {
  return process.env.PLAYWRIGHT_TEST === 'true';
};

/**
 * Sharpを初期化する
 * アプリケーション起動時に一度だけ呼び出す
 *
 * @param options 設定オプション（省略時はデフォルト設定）
 *
 * ## Playwright環境での動作
 * Playwright環境では、GTKとlibvipsのGLib-GObject競合を防ぐため、
 * 常にLOW_MEMORY_CONFIG（concurrency=1, cache=false）を使用する
 */
export const initializeSharp = (
  options: Partial<SharpConfigOptions> = {},
): void => {
  // Playwright環境では常に低メモリ設定を強制（GLib-GObject競合防止）
  const baseConfig = isPlaywrightTestEnvironment()
    ? LOW_MEMORY_CONFIG
    : DEFAULT_CONFIG;

  const config: SharpConfigOptions = {
    ...baseConfig,
    ...options,
  };

  // concurrency設定
  sharp.concurrency(config.concurrency);

  // cache設定
  if (config.cache === false) {
    sharp.cache(false);
  } else {
    sharp.cache(config.cache);
  }

  currentConfig = config;
  isInitialized = true;

  logger.info({
    message: 'Sharp initialized with optimized settings',
    details: {
      concurrency: sharp.concurrency(),
      cache: sharp.cache(),
      simd: sharp.simd(),
    },
  });
};

/**
 * 低メモリモードに切り替える
 * 初回起動時や大量写真処理時に使用
 */
export const switchToLowMemoryMode = (): void => {
  sharp.concurrency(LOW_MEMORY_CONFIG.concurrency);
  sharp.cache(false);
  currentConfig = LOW_MEMORY_CONFIG;

  logger.debug({
    message: 'Sharp switched to low memory mode',
    details: {
      concurrency: sharp.concurrency(),
      cache: sharp.cache(),
    },
  });
};

/**
 * 通常モードに戻す
 *
 * ## Playwright環境での動作
 * Playwright環境では「通常モード」でもLOW_MEMORY_CONFIGを使用する
 * （GLib-GObject競合を常に回避するため）
 */
export const switchToNormalMode = (): void => {
  // Playwright環境では「通常モード」でも低メモリ設定を維持
  const config = isPlaywrightTestEnvironment()
    ? LOW_MEMORY_CONFIG
    : DEFAULT_CONFIG;
  initializeSharp(config);

  logger.debug({
    message: 'Sharp switched to normal mode',
    details: {
      concurrency: sharp.concurrency(),
      cache: sharp.cache(),
      isPlaywrightTest: isPlaywrightTestEnvironment(),
    },
  });
};

/**
 * Sharpのキャッシュをクリアする
 * バッチ処理間でメモリを解放するために使用
 */
export const clearSharpCache = (): void => {
  // cache(false)を呼び出すとキャッシュがクリアされる
  // その後元の設定に戻す
  const previousCache = currentConfig.cache;
  sharp.cache(false);

  if (previousCache !== false) {
    sharp.cache(previousCache);
  }

  logger.debug('Sharp cache cleared');
};

/**
 * 現在の設定を取得
 */
export const getCurrentConfig = (): SharpConfigOptions => {
  return { ...currentConfig };
};

/**
 * 初期化済みかどうかを確認
 */
export const isSharpInitialized = (): boolean => {
  return isInitialized;
};

/**
 * Sharp統計情報を取得（デバッグ用）
 */
export const getSharpStats = (): {
  concurrency: number;
  cache: ReturnType<typeof sharp.cache>;
  simd: boolean;
  versions: typeof sharp.versions;
} => {
  return {
    concurrency: sharp.concurrency(),
    cache: sharp.cache(),
    simd: sharp.simd(),
    versions: sharp.versions,
  };
};
