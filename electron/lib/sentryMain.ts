import {
  type Event,
  type EventHint,
  init as initSentry,
} from '@sentry/electron/main';

import { scrubEventData } from '../../src/lib/utils/masking';
import { SENTRY_DATA_COLLECTION } from '../constants/sentryDataCollection';
import { getSettingStore } from '../module/settingStore';
import { hasAcceptedCurrentTerms } from '../module/terms/consent';
import { getApp } from './electronModules';
import { logger } from './logger';

interface ErrorEvent extends Event {
  type: undefined;
}

let isSentryInitializedMain = false;

/**
 * main プロセスのエラー監視（Sentry）を初期化する。殻の側だけが呼ぶ。
 *
 * 起動直後と、利用者が規約に同意したとき（殻の `onTermsAccepted`）に呼ばれる。
 * 2 度目以降は何もしない。初期化しても、送信のたびに現在の版の規約への同意を確かめ、
 * 同意が無ければイベントを捨てる。
 *
 * 設定ストアは送信時の同意の確認に使うので、`initSettingStore()` の後に呼ぶ。
 */
export const initializeMainSentry = (): void => {
  if (isSentryInitializedMain) {
    logger.info('Sentry already initialized in main process.');
    return;
  }
  // SENTRY_DSN がなければ初期化しない
  if (!process.env.SENTRY_DSN) {
    logger.info('Sentry not initialized in main process (SENTRY_DSN not set)');
    return;
  }

  const isDev = !getApp().isPackaged;
  const settingStore = getSettingStore();

  logger.info(
    `Sentry initializing in main process via electron/lib/sentryMain.ts: isDev: ${isDev}`,
  );
  initSentry({
    dsn: process.env.SENTRY_DSN,
    environment: isDev ? 'development' : 'production',
    debug: isDev,
    // __SENTRY_RELEASE__ はビルド時に Sentry プラグインによって置換される
    // リリースバージョンを表す定数
    release: __SENTRY_RELEASE__,
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeSend: (event: ErrorEvent, _hint: EventHint) => {
      // 開発環境でも、現在の版の規約に同意しているかを確かめる
      if (!hasAcceptedCurrentTerms(settingStore)) {
        if (isDev) {
          logger.info(
            'Sentry event dropped in development mode due to terms not accepted.',
          );
        } else {
          logger.info('Sentry event dropped due to terms not accepted.');
        }
        return null;
      }

      const processedEvent = scrubEventData(event);

      if (isDev) {
        logger.info('Sentry event sent in development mode.');
      }

      return processedEvent;
    },
  });
  logger.info(
    isDev
      ? 'Sentry initialized in main process for development (terms check enabled).'
      : 'Sentry initialized in main process. Event sending depends on terms acceptance.',
  );
  isSentryInitializedMain = true;
};
