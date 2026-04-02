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
import * as Sentry from '@sentry/node';

import { logger } from './lib/logger';
import { initSettingStore } from './module/settingStore';

// 設定ストアの初期化（他モジュールが getSettingStore() で取得するため副作用として実行）
initSettingStore();

let isSentryInitializedMain = false;
export const getIsSentryInitializedMain = () => isSentryInitializedMain;

/**
 * メインプロセスの Sentry を初期化する。
 *
 * 背景: @sentry/electron から @sentry/node に移行。
 * Electrobun ではメインプロセスが Bun ランタイムで動作するため、
 * Node.js 用の @sentry/node を使用する。
 *
 * 呼び出し元: このファイル末尾（モジュール読み込み時に実行）
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

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'production',
    /**
     * beforeSend でユーザー規約への同意状態をチェックする。
     * 同意していない場合はイベントを送信しない（プライバシー保護）。
     */
    beforeSend: (event) => {
      // effect-lint-allow-try-catch: Sentry コールバック内では settingStore の取得失敗を許容
      try {
        const { getSettingStore } = require('./module/settingStore');
        const store = getSettingStore();
        if (!store.getTermsAccepted()) {
          return null;
        }
      } catch {
        // settingStore 未初期化時はイベントを送信しない
        return null;
      }
      return event;
    },
  });

  logger.info('Sentry initialized in main process via @sentry/node');
  isSentryInitializedMain = true;
};

initializeMainSentry();
