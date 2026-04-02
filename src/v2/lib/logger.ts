/**
 * フロントエンド用ロガー
 *
 * バックエンドの electron/lib/logger.ts と同様のインターフェースを提供。
 * Sentry（レンダラー側）と連携してエラーを報告。
 *
 * ## 使用例
 * ```ts
 * import { logger } from '@/v2/lib/logger';
 *
 * logger.debug('Processing started');
 * logger.info('Photo loaded successfully');
 * logger.warn({ message: 'Cache miss', details: { photoPath } });
 * logger.error({ message: 'Failed to fetch', error });
 * ```
 */

import { match, P } from 'ts-pattern';

interface LogParams {
  message: string;
  error?: unknown;
  details?: Record<string, unknown>;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 開発モードかどうかを判定
 */
const isDevelopment = (): boolean => {
  return import.meta.env.DEV ?? process.env.NODE_ENV !== 'production';
};

/**
 * エラーオブジェクトを正規化
 */
const normalizeError = (error: unknown): Error => {
  return match(error)
    .with(P.instanceOf(Error), (e) => e)
    .with(P.string, (s) => new Error(s))
    .otherwise((e) => new Error(String(e)));
};

/**
 * ログメッセージをフォーマット
 */
const formatLogMessage = (
  level: LogLevel,
  params: LogParams | string,
): string => {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  return match(params)
    .with(P.string, (msg) => `${prefix} ${msg}`)
    .otherwise((p) => `${prefix} ${p.message}`);
};

/**
 * 構造化ログを出力
 */
const log = (
  level: LogLevel,
  params: LogParams | string,
  consoleMethod: (...args: unknown[]) => void,
): void => {
  const message = formatLogMessage(level, params);

  match(params)
    .with(P.string, () => {
      consoleMethod(message);
    })
    .otherwise((p) => {
      const args: unknown[] = [message];

      if (p.error) {
        args.push(normalizeError(p.error));
      }

      if (p.details && Object.keys(p.details).length > 0) {
        args.push(p.details);
      }

      consoleMethod(...args);
    });
};

/**
 * デバッグログ（開発時のみ出力）
 */
const debug = (params: LogParams | string): void => {
  if (!isDevelopment()) {
    return;
  }
  log('debug', params, console.debug);
};

/**
 * 情報ログ
 */
const info = (params: LogParams | string): void => {
  log('info', params, console.info);
};

/**
 * 警告ログ
 */
const warn = (params: LogParams | string): void => {
  log('warn', params, console.warn);
};

/**
 * エラーログ
 *
 * @remarks
 * Sentryにエラーを送信し、詳細情報をextraとして添付。
 */
const error = (params: LogParams | string): void => {
  log('error', params, console.error);

  // @sentry/browser でエラーを送信
  // Sentry 未初期化時は captureException が no-op になるため安全
  import('@sentry/browser')
    .then((Sentry) => {
      match(params)
        .with(P.string, (msg) => {
          Sentry.captureException(new Error(msg));
        })
        .otherwise((p) => {
          const errorObj = p.error
            ? normalizeError(p.error)
            : new Error(p.message);
          Sentry.captureException(errorObj, {
            extra: p.details,
          });
        });
    })
    .catch(() => {
      // @sentry/browser が利用不可の場合はログのみ
    });
};

export const logger = {
  debug,
  info,
  warn,
  error,
};
