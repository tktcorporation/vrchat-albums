import { captureException } from '@sentry/electron/main';
import * as log from 'electron-log';
import { Result } from 'neverthrow';
import path from 'pathe';
import { stackWithCauses } from 'pony-cause';
import { match, P } from 'ts-pattern';
import { getSettingStore } from '../module/settingStore';
import { UserFacingError } from './errors';

// ログファイルパスを遅延評価する
const getLogFilePath = (): string => {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('logs'), 'app.log');
  } catch {
    // テストまたは非Electron環境
    return path.join(__dirname, 'test-app.log');
  }
};

const logFilePath = getLogFilePath();

log.transports.file.resolvePathFn = () => logFilePath;

// ファイルサイズの上限設定（例: 5MB）
log.transports.file.maxSize = 5 * 1024 * 1024;

// ログレベルの設定
const getIsProduction = (): boolean => {
  try {
    const { app } = require('electron');
    return app.isPackaged;
  } catch {
    return false;
  }
};

const isProduction = getIsProduction();
log.transports.file.level = isProduction ? 'info' : 'debug';
log.transports.console.level = isProduction ? 'warn' : 'debug';

// ログフォーマットの設定
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';
log.transports.console.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';

interface ErrorLogParams {
  message: unknown;
  stack?: Error;
  details?: Record<string, unknown>;
}

/**
 * 受け取ったメッセージを Error オブジェクトに変換するユーティリティ。
 * buildErrorInfo や error 関数から利用される。
 */
const normalizeError = (message: unknown): Error => {
  return match(message)
    .with(P.instanceOf(Error), (e) => e)
    .otherwise((m) => new Error(String(m)));
};

/**
 * stack 情報を含めたエラーオブジェクトを生成するヘルパー。
 * Sentry 送信前の整形処理で使用される。
 */
const buildErrorInfo = ({ message, stack }: ErrorLogParams): Error => {
  const baseError = match(message)
    .with(P.instanceOf(Error), (e) => e)
    .otherwise((m) => normalizeError(m));

  return match(stack)
    .with(undefined, () => baseError)
    .otherwise((s) => {
      // Original errorのプロパティを保持しつつstackを更新
      const errorInfo = Object.create(Object.getPrototypeOf(baseError));
      Object.assign(errorInfo, baseError, {
        name: baseError.name,
        message: baseError.message,
        stack: s.stack,
        cause: baseError.cause || s,
      });

      return errorInfo;
    });
};

const info = log.info;
const debug = log.debug;
const warn = log.warn;
/**
 * Sentry への送信も行うエラー出力用ラッパー関数。
 */
const error = ({ message, stack, details }: ErrorLogParams): void => {
  const normalizedError = normalizeError(message);
  const errorInfo = buildErrorInfo({ message, stack });

  // ログ出力
  log.error(
    stackWithCauses(normalizedError),
    ...(stack ? [stackWithCauses(stack)] : []),
    ...(details ? [details] : []),
  );

  // 規約同意済みかどうかを確認
  const termsAccepted = Result.fromThrowable(
    () => {
      const settingStore = getSettingStore();
      return settingStore.getTermsAccepted();
    },
    (error) => error,
  )().match(
    (accepted) => accepted,
    (error) => {
      log.warn('Failed to get terms accepted:', error);
      return false;
    },
  );

  // UserFacingErrorの場合でもcauseがあればSentryに送信（予期しないエラーの詳細を取得するため）
  // causeがない純粋なUserFacingErrorは意図的に処理されたエラーなので送信しない
  const userFacingError = match(normalizedError)
    .with(P.instanceOf(UserFacingError), (e) => e)
    .otherwise(() => null);

  const causeError = match(userFacingError?.errorInfo?.cause)
    .with(P.instanceOf(Error), (e) => e)
    .otherwise(() => null);

  const shouldSendToSentry = match({ userFacingError, causeError })
    .with({ userFacingError: P.nullish }, () => true) // 通常のエラー → 送信
    .with({ causeError: P.not(P.nullish) }, () => true) // UserFacingError with cause → 送信
    .otherwise(() => false); // UserFacingError without cause → スキップ

  // 規約同意済みかつハンドルされていないエラーの場合のみSentryへ送信
  match({ termsAccepted, shouldSendToSentry })
    .with({ termsAccepted: true, shouldSendToSentry: true }, () => {
      log.debug('Attempting to send error to Sentry...');
      // UserFacingErrorの場合はcauseを送信、それ以外は元のエラーを送信
      const errorToSend = causeError ?? errorInfo;
      const sendResult = Result.fromThrowable(
        () => {
          captureException(errorToSend, {
            extra: {
              ...(stack ? { stack: stackWithCauses(stack) } : {}),
              ...(details ? { details } : {}),
              // UserFacingErrorの場合は追加情報を付与
              ...(userFacingError
                ? {
                    userFacingMessage: userFacingError.message,
                    errorCode: userFacingError.errorInfo?.code,
                    errorCategory: userFacingError.errorInfo?.category,
                  }
                : {}),
            },
            tags: {
              source: 'electron-main',
              ...(userFacingError ? { hasUserFacingWrapper: 'true' } : {}),
            },
          });
        },
        (error) => error,
      )();
      sendResult.match(
        () =>
          log.debug(
            `Error sent to Sentry successfully${causeError ? ' (cause from UserFacingError)' : ''}`,
          ),
        (sentryError) =>
          log.debug('Failed to send error to Sentry:', sentryError),
      );
    })
    .with({ termsAccepted: true, shouldSendToSentry: false }, () => {
      log.debug(
        'UserFacingError without cause detected, skipping Sentry (handled error)',
      );
    })
    .with({ termsAccepted: false }, () => {
      log.debug('Terms not accepted, skipping Sentry error');
    })
    .exhaustive();
};

const electronLogFilePath = log.transports.file.getFile().path;

const logger = {
  info,
  debug,
  error,
  warn,
  transports: {
    file: log.transports.file,
    console: log.transports.console,
  },
  setTransportsLevel: (level: log.LevelOption) => {
    log.transports.file.level = level;
    log.transports.console.level = level;
  },
  electronLogFilePath,
};

export { logger };
