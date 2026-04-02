/**
 * メインプロセスのエントリポイント（Electrobun 互換版）。
 *
 * 背景: Electron 版では app.whenReady() で初期化していた。
 * Electrobun では src/bun/index.ts がエントリポイントとなるが、
 * tRPC ルーター（electron/api.ts）が参照するモジュールの依存解決のため、
 * このファイルは Sentry 初期化等のエクスポートを維持する。
 *
 * Electrobun のメイン起動処理: src/bun/index.ts
 */
import { logger } from './lib/logger';
import { initSettingStore } from './module/settingStore';

// 設定ストアの初期化（他モジュールが getSettingStore() で取得するため副作用として実行）
initSettingStore();

let isSentryInitializedMain = false;
export const getIsSentryInitializedMain = () => isSentryInitializedMain;

/**
 * Sentry 初期化スタブ。
 *
 * 背景: @sentry/electron は Electrobun では利用不可。
 * @sentry/node への移行が必要。現在はスタブとして残す。
 *
 * TODO: @sentry/node を使った初期化に置き換え
 */
export const initializeMainSentry = () => {
  if (isSentryInitializedMain) {
    logger.info('Sentry already initialized in main process.');
    return;
  }
  if (!process.env.SENTRY_DSN) {
    logger.info('Sentry not initialized in main process (SENTRY_DSN not set)');
    return;
  }

  // TODO: @sentry/node で初期化
  logger.info(
    'Sentry initialization skipped (Electrobun migration in progress)',
  );
  isSentryInitializedMain = true;
};

initializeMainSentry();
