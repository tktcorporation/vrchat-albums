/**
 * フロントエンド用ロガー
 *
 * バックエンドの electron/lib/logger.ts と同様のインターフェースを提供。
 * 将来的には Sentry（レンダラー側）との連携も可能。
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
  if (!isDevelopment()) return;
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
 * 将来的にはSentry連携を追加予定。
 * 現時点ではconsole.errorに出力のみ。
 */
const error = (params: LogParams | string): void => {
  log('error', params, console.error);

  // TODO: Sentry連携
  // captureException(normalizeError(params.error), { extra: params.details });
};

export const logger = {
  debug,
  info,
  warn,
  error,
};
