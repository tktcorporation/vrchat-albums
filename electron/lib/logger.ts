import { captureException } from '@sentry/electron/main';
import { app } from 'electron';
import * as log from 'electron-log';
import path from 'pathe';
import { stackWithCauses } from 'pony-cause';

// appが未定義の場合はテスト環境や非Electron環境として判定
const logFilePath = app
  ? path.join(app.getPath('logs'), 'app.log') // Electron環境
  : path.join(__dirname, 'test-app.log'); // テストまたは非Electron環境

log.transports.file.resolvePathFn = () => logFilePath;

// ファイルサイズの上限設定（例: 5MB）
log.transports.file.maxSize = 5 * 1024 * 1024;

// ログレベルの設定
const isProduction = app?.isPackaged ?? false;
log.transports.file.level = isProduction ? 'info' : 'debug';
log.transports.console.level = isProduction ? 'warn' : 'debug';

// ログフォーマットの設定
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';
log.transports.console.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';

interface ErrorLogParams {
  message: unknown;
  stack?: Error;
}

// エラーオブジェクトの正規化
const normalizeError = (message: unknown): Error => {
  return message instanceof Error ? message : new Error(String(message));
};

// エラー情報の構築
const buildErrorInfo = ({ message, stack }: ErrorLogParams): Error => {
  const baseError = message instanceof Error ? message : null;
  if (!stack) return baseError || normalizeError(message);

  return {
    ...baseError,
    stack: stack.stack,
  } as Error;
};

const info = log.info;
const debug = log.debug;
const error = ({ message, stack }: ErrorLogParams): void => {
  const normalizedError = normalizeError(message);
  const errorInfo = buildErrorInfo({ message, stack });

  // ログ出力
  log.error(
    stackWithCauses(normalizedError),
    ...(stack ? [stackWithCauses(stack)] : []),
  );

  // 本番環境でのみSentryへ送信
  if (isProduction) {
    captureException(errorInfo, {
      extra: stack ? { stack: stackWithCauses(stack) } : undefined,
    });
  }
};

const electronLogFilePath = log.transports.file.getFile().path;

const logger = {
  info,
  debug,
  error,
  electronLogFilePath,
};

export { info, debug, error, electronLogFilePath, logger, log };
