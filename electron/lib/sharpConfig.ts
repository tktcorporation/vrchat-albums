/**
 * Sharp (libvips) の設定管理
 *
 * 大量の写真を処理する際のメモリ使用量を制御するための設定。
 *
 * ## 初期化の2段階構造
 *
 * 1. **早期初期化** (electron/index.ts)
 *    - GTK/libvips の GLib-GObject 競合を防ぐため、アプリ起動直後に実行
 *    - `sharp.concurrency(1); sharp.cache(false);` で最小設定
 *
 * 2. **アプリ内設定** (このモジュール)
 *    - 写真処理開始時に適切な設定に調整
 *    - Linux環境では常に低メモリモード（GLib競合回避）
 *    - Windows/Mac環境ではデフォルト設定
 *
 * ## 参考
 * - https://sharp.pixelplumbing.com/api-utility#concurrency
 * - https://sharp.pixelplumbing.com/api-utility#cache
 */

import sharp from 'sharp';
import { isLinuxPlatform } from './environment';

/**
 * loggerを遅延インポート
 *
 * sharpConfig.tsがloggerをトップレベルでインポートすると、
 * loggerが@sentry/electron/mainやelectron-logをインポートし、
 * それがGTKを読み込んでGLib-GObject競合を引き起こす。
 *
 * 遅延インポートにより、Sharp初期化後にのみloggerが読み込まれる。
 */
const logDebug = async (message: string | object) => {
  const { logger } = await import('./logger');
  logger.debug(message);
};

const logInfo = async (message: object) => {
  const { logger } = await import('./logger');
  logger.info(message);
};

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
 * 低メモリ設定
 *
 * 以下の状況で使用:
 * - 初回起動時の大量写真処理
 * - Linux環境（GTK/libvipsのGLib-GObject競合回避）
 *
 * - concurrency: 1（シングルスレッド）
 * - cache: 無効（メモリ使用量最小化）
 */
export const LOW_MEMORY_CONFIG: SharpConfigOptions = {
  concurrency: 1,
  cache: false,
};

let isInitialized = false;
let currentConfig: SharpConfigOptions = LOW_MEMORY_CONFIG;

/**
 * 現在の環境に適した設定を取得
 *
 * Linux環境では常に LOW_MEMORY_CONFIG を返す（GLib競合回避）
 * Windows/Mac環境では requestedConfig をそのまま返す
 */
const getEnvironmentAppropriateConfig = (
  requestedConfig: SharpConfigOptions,
): SharpConfigOptions => {
  // Linux環境では常に低メモリ設定を強制（GLib-GObject競合防止）
  return isLinuxPlatform() ? LOW_MEMORY_CONFIG : requestedConfig;
};

/**
 * Sharpの設定を適用
 */
const applyConfig = (config: SharpConfigOptions): void => {
  sharp.concurrency(config.concurrency);

  if (config.cache === false) {
    sharp.cache(false);
  } else {
    sharp.cache(config.cache);
  }

  currentConfig = config;
};

/**
 * Sharpを初期化する
 *
 * @param options 設定オプション（省略時はデフォルト設定）
 *
 * ## 注意
 * Linux環境では、指定した設定に関わらず LOW_MEMORY_CONFIG が適用される
 */
export const initializeSharp = (
  options: Partial<SharpConfigOptions> = {},
): void => {
  // オプションをデフォルト設定にマージ
  const config: SharpConfigOptions = {
    ...DEFAULT_CONFIG,
    ...options,
  };

  // Linux環境では強制的に低メモリ設定（1回のみ呼び出し）
  const finalConfig = getEnvironmentAppropriateConfig(config);
  applyConfig(finalConfig);

  isInitialized = true;

  // 非同期でログ出力（fire-and-forget）
  void logInfo({
    message: 'Sharp initialized',
    details: {
      concurrency: sharp.concurrency(),
      cache: sharp.cache(),
      simd: sharp.simd(),
      platform: process.platform,
      isLinux: isLinuxPlatform(),
    },
  });
};

/**
 * 低メモリモードに切り替える
 *
 * 初回起動時や大量写真処理時に使用。
 * 処理完了後は restoreDefaultMode() で戻す。
 */
export const switchToLowMemoryMode = (): void => {
  applyConfig(LOW_MEMORY_CONFIG);

  void logDebug({
    message: 'Sharp: low memory mode',
    details: {
      concurrency: sharp.concurrency(),
      cache: sharp.cache(),
    },
  });
};

/**
 * デフォルト設定に戻す
 *
 * 大量処理完了後に呼び出す。
 *
 * ## 注意
 * Linux環境では LOW_MEMORY_CONFIG のままとなる（GLib競合回避のため）
 */
export const restoreDefaultMode = (): void => {
  const config = getEnvironmentAppropriateConfig(DEFAULT_CONFIG);
  applyConfig(config);

  void logDebug({
    message: 'Sharp: default mode restored',
    details: {
      concurrency: sharp.concurrency(),
      cache: sharp.cache(),
      platform: process.platform,
      isLinux: isLinuxPlatform(),
    },
  });
};

/**
 * Sharpのキャッシュをクリアする
 *
 * バッチ処理間でメモリを解放するために使用。
 * キャッシュクリア後、元の設定に戻る。
 */
export const clearSharpCache = (): void => {
  const previousCache = currentConfig.cache;
  sharp.cache(false);

  if (previousCache !== false) {
    sharp.cache(previousCache);
  }

  void logDebug('Sharp cache cleared');
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
