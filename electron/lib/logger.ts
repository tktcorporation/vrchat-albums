import fs from 'node:fs';
import path from 'node:path';

/**
 * アプリケーションロガー。
 *
 * 背景: Electron 版では electron-log + @sentry/electron を使用していた。
 * Electrobun 移行後は consola（既存依存）+ ファイル出力に置き換え。
 * Sentry 連携は @sentry/node を使用。
 */
import * as Sentry from '@sentry/node';
import { createConsola } from 'consola';
import { stackWithCauses } from 'pony-cause';
import { match, P } from 'ts-pattern';

/**
 * ログファイルのパスを取得する。
 * Electrobun の Utils.paths.userLogs が利用可能であれば使用、
 * そうでなければフォールバック。
 */
const getLogFilePath = (): string => {
  try {
    // Electrobun 環境
    const { Utils } = require('electrobun/bun');
    return path.join(Utils.paths.userLogs, 'app.log');
  } catch {
    // テストまたは非 Electrobun 環境
    return path.join(__dirname, 'test-app.log');
  }
};

const logFilePath = getLogFilePath();

// ログディレクトリの作成
try {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
} catch {
  // ディレクトリが既に存在する場合は無視
}

const consola = createConsola({
  level: process.env.NODE_ENV === 'production' ? 3 : 4, // info : debug
});

/**
 * ファイルにログを追記する内部関数。
 */
const writeToFile = (level: string, message: string): void => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${timestamp} [${level}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {
    // ファイル書き込みに失敗してもクラッシュしない
  }
};

interface ErrorLogParams {
  message: unknown;
  stack?: Error;
  details?: Record<string, unknown>;
}

/**
 * 受け取ったメッセージを Error オブジェクトに変換するユーティリティ。
 */
const normalizeError = (message: unknown): Error => {
  return match(message)
    .with(P.instanceOf(Error), (e) => e)
    .otherwise((m) => new Error(String(m)));
};

const info = (...args: unknown[]): void => {
  const msg = args.map(String).join(' ');
  consola.info(msg);
  writeToFile('info', msg);
};

const debug = (...args: unknown[]): void => {
  const msg = args.map(String).join(' ');
  consola.debug(msg);
  writeToFile('debug', msg);
};

const warn = (...args: unknown[]): void => {
  const msg = args.map(String).join(' ');
  consola.warn(msg);
  writeToFile('warn', msg);
};

/**
 * Sentry への送信も行う warning レベルのログ出力ラッパー。
 *
 * 背景: @sentry/electron から @sentry/node に移行。
 * captureMessage で warning を Sentry に送信する。
 * ユーザー同意チェックは Sentry.init の beforeSend で行う。
 */
const warnWithSentry = ({ message, stack, details }: ErrorLogParams): void => {
  const messageString = match(message)
    .with(P.instanceOf(Error), (e) => e.message)
    .otherwise(String);

  consola.warn(
    messageString,
    ...(stack ? [stackWithCauses(stack)] : []),
    ...(details ? [details] : []),
  );
  writeToFile('warn', messageString);

  Sentry.captureMessage(messageString, {
    level: 'warning',
    extra: details,
  });
};

/**
 * Sentry への送信も行うエラー出力用ラッパー関数。
 *
 * 背景: @sentry/electron から @sentry/node に移行。
 * captureException でエラーを Sentry に送信する。
 */
const error = ({ message, stack, details }: ErrorLogParams): void => {
  const normalizedError = normalizeError(message);

  consola.error(
    stackWithCauses(normalizedError),
    ...(stack ? [stackWithCauses(stack)] : []),
    ...(details ? [details] : []),
  );
  writeToFile('error', stackWithCauses(normalizedError));

  Sentry.captureException(stack ?? normalizedError, {
    extra: details,
  });
};

const logger = {
  info,
  debug,
  error,
  warn,
  warnWithSentry,
  transports: {
    file: {
      getFile: () => ({ path: logFilePath }),
      level: 'info' as string | false,
    },
    console: { level: 'info' as string | false },
  },
  setTransportsLevel: (_level: string) => {
    // consola のレベル変更は将来対応
  },
  electronLogFilePath: logFilePath,
};

export { logger };
