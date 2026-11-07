import {
  type Event,
  type EventHint,
  init as initSentry,
} from '@sentry/electron/main';

import { scrubEventData } from '../../src/lib/utils/masking';
import { SENTRY_DATA_COLLECTION } from '../constants/sentryDataCollection';
import { hasAcceptedCurrentTerms } from '../module/terms/consent';
import { getApp } from './electronModules';
import { logger } from './logger';
import type { SettingsSnapshot } from './settingsFile';

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
 * 処理本体（utilityProcess）のイベントも、`@sentry/electron/utility` から main の SDK へ渡り、
 * main の `captureEvent` を通るので、ここの `beforeSend` が同じ判定と伏せ字をかける。
 * そのため処理本体の起動（`utilityProcess.fork`）より前に呼ぶ。SDK は初期化のときに fork を包み、
 * 処理本体へイベントの送り道を渡すので、初期化より前に起動した処理本体からは送れない。
 *
 * @param readSettings 送信のたびに呼び、設定ファイルから同意の状態を読む。
 *   設定ファイルを書くのは処理本体なので、main は値を覚えずに読み直す
 */
export const initializeMainSentry = (
  readSettings: () => Pick<SettingsSnapshot, 'termsAccepted' | 'termsVersion'>,
): void => {
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
      const settings = readSettings();
      if (
        !hasAcceptedCurrentTerms({
          getTermsAccepted: () => settings.termsAccepted,
          getTermsVersion: () => settings.termsVersion,
        })
      ) {
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

/** main のエラー監視が初期化済みか。処理本体のエラー監視は、これが true のときだけ初期化する */
export const isMainSentryInitialized = (): boolean => isSentryInitializedMain;
