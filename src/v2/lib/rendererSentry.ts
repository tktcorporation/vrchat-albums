import type { Event, EventHint } from '@sentry/electron/main';
import { init as initSentry } from '@sentry/electron/renderer';

import { scrubEventData } from '@/lib/utils/masking';
import { trpcClient } from '@/trpc';

import { SENTRY_DATA_COLLECTION } from '../../../electron/constants/sentryDataCollection';

// Electron レンダラープロセスでの開発環境検出
const isDev = process.env.NODE_ENV === 'development';

interface ErrorEvent extends Event {
  type: undefined;
}

let initialized = false;

/**
 * レンダラープロセスのエラー監視を始める。規約に同意した後に一度だけ呼ばれる想定で、2 回目以降は何もしない
 * （開発時の StrictMode では effect が二重に走るため）。
 *
 * 送信の直前にもメインプロセスへ同意状況を問い合わせ、同意済みと保存されているときだけ、
 * 個人情報を伏せたうえで送る。問い合わせに失敗したら送らない。
 */
export const initRendererSentry = (): void => {
  if (initialized) {
    return;
  }
  initialized = true;
  initSentry({
    dsn: process.env.SENTRY_DSN,
    environment: isDev ? 'development' : 'production',
    debug: isDev,
    // Sentryプラグインが注入するリリース識別子
    release: __SENTRY_RELEASE__,
    dataCollection: SENTRY_DATA_COLLECTION,
    tags: {
      source: 'electron-renderer',
    },
    beforeSend: async (event: ErrorEvent, _hint: EventHint) =>
      trpcClient.getTermsAccepted.query().then(
        (status) => (status.accepted ? scrubEventData(event) : null),
        (error: unknown) => {
          console.error(
            'Failed to query terms status from main process for Sentry:',
            error,
          );
          return null;
        },
      ),
  });
};
