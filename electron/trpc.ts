import { EventEmitter } from 'node:events';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { match, P } from 'ts-pattern';
import type { ZodError } from 'zod';
import { UserFacingError } from './lib/errors';
import { logger } from './lib/logger';
import * as settingService from './module/settings/service';

const eventEmitter = new EventEmitter();

const t = initTRPC.context<{ eventEmitter: EventEmitter }>().create({
  isServer: true,
  transformer: superjson,
  errorFormatter: (opts) => {
    const { shape, error } = opts;
    const cause = error.cause;

    let userMessage = '予期しないエラーが発生しました。';
    let structuredErrorInfo: {
      code: string;
      category: string;
      userMessage: string;
    } | null = null;

    // ネストされたUserFacingErrorも含めて検索
    const findUserFacingError = (err: unknown): UserFacingError | null => {
      if (err instanceof UserFacingError) return err;
      if (err && typeof err === 'object' && 'cause' in err) {
        return findUserFacingError((err as { cause: unknown }).cause);
      }
      return null;
    };

    const userFacingError = findUserFacingError(cause);

    if (userFacingError) {
      if (
        userFacingError.errorInfo?.code &&
        userFacingError.errorInfo?.category
      ) {
        const {
          code,
          category,
          userMessage: errorUserMessage,
        } = userFacingError.errorInfo;

        userMessage = errorUserMessage || userFacingError.message;
        structuredErrorInfo = {
          code,
          category,
          userMessage,
        };
      } else {
        userMessage = userFacingError.message;
      }
    }

    // 元のcauseベースのマッチングも維持（Zod errorなど）
    match(cause)
      .when(
        (c): c is ZodError =>
          c instanceof Error &&
          c.name === 'ZodError' &&
          'issues' in c &&
          Array.isArray((c as ZodError).issues) &&
          (c as ZodError).issues.length > 0,
        (err) => {
          userMessage = err.issues[0].message;
          structuredErrorInfo = {
            code: 'VALIDATION_ERROR',
            category: 'VALIDATION_ERROR',
            userMessage: err.issues[0].message,
          };
        },
      )
      .when(
        (c): c is Error =>
          c instanceof Error && c.message.includes('test error for Sentry'),
        () => {
          userMessage = 'Sentryテスト用のエラーが発生しました。';
        },
      )
      .otherwise(() => {
        // ネストされたUserFacingErrorが見つからない場合のみデフォルトメッセージ
        if (!userFacingError) {
          userMessage = '予期しないエラーが発生しました。';
        }
      });

    // UserFacingErrorの場合は詳細情報を表示しない（構造化エラー情報で十分）
    const debugInfo = match(cause)
      .with(
        P.intersection(
          P.instanceOf(Error),
          P.not(P.instanceOf(UserFacingError)),
        ),
        (err) =>
          ` [詳細: ${err.message}${
            err.stack
              ? `\nStack: ${err.stack.split('\n').slice(0, 3).join('\n')}`
              : ''
          }]`,
      )
      .otherwise(() => '');

    return {
      ...shape,
      message: userMessage + debugInfo,
      data: {
        ...shape.data,
        // 構造化エラー情報を含める（フロントエンドでの解析用）
        ...(structuredErrorInfo
          ? { structuredError: structuredErrorInfo }
          : {}),
        // 原因エラーの詳細も含める（UserFacingError以外の場合）
        ...match(cause)
          .with(
            P.intersection(
              P.instanceOf(Error),
              P.not(P.instanceOf(UserFacingError)),
            ),
            (err) => ({
              originalError: {
                name: err.name,
                message: err.message,
                stack: err.stack,
              },
            }),
          )
          .otherwise(() => ({})),
      },
    };
  },
});

/**
 * tRPC ミドルウェアから呼び出されるエラーログ用関数
 * バージョン情報とリクエスト内容を付加して Sentry へ送信する
 * 構造化エラー情報に基づいてトーストメッセージを送信する
 */
const logError = (
  err: Error | string,
  requestInfo?: string,
  originalError?: Error,
) => {
  const errorToLog =
    originalError ||
    match(err)
      .with(P.instanceOf(Error), (e) => e)
      .otherwise(() => new Error(String(err)));
  const appVersion = settingService.getAppVersion();

  logger.error({
    message: `version: ${appVersion}, request: ${requestInfo}, error: ${errorToLog.message}`,
    stack: errorToLog,
  });

  // 構造化エラー情報を含むトーストメッセージを生成
  match(err)
    .with(P.instanceOf(UserFacingError), (userErr) => {
      // 構造化エラー情報がある場合
      if (userErr.code && userErr.category) {
        const structuredToastMessage = {
          message: userErr.message,
          errorInfo: {
            code: userErr.code,
            category: userErr.category,
            userMessage: userErr.userMessage || userErr.message,
          },
        };
        eventEmitter.emit('toast', structuredToastMessage);
      } else {
        // UserFacingErrorだが構造化情報がない場合
        eventEmitter.emit('toast', userErr.message);
      }
    })
    .with(P.instanceOf(Error), (error) => {
      // Zodバリデーションエラーの場合
      if (
        error.name === 'ZodError' &&
        'issues' in error &&
        Array.isArray((error as ZodError).issues) &&
        (error as ZodError).issues.length > 0
      ) {
        const validationMessage = (error as ZodError).issues[0].message;
        const structuredToastMessage = {
          message: validationMessage,
          errorInfo: {
            code: 'VALIDATION_ERROR',
            category: 'VALIDATION_ERROR',
            userMessage: validationMessage,
          },
        };
        eventEmitter.emit('toast', structuredToastMessage);
      } else if (error.message.includes('test error for Sentry')) {
        // Sentryテスト用エラーの場合
        eventEmitter.emit('toast', 'Sentryテスト用のエラーが発生しました。');
      } else {
        // その他のエラー
        eventEmitter.emit('toast', '予期しないエラーが発生しました。');
      }
    })
    .with(P.string, () => {
      // 文字列エラーの場合
      eventEmitter.emit('toast', '予期しないエラーが発生しました。');
    })
    .exhaustive();
};

const errorHandler = t.middleware(async (opts) => {
  try {
    const result = await opts.next(opts);
    if (!result.ok) {
      const originalError = match(result.error.cause)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise(() => result.error);
      const requestInfo = `${opts.type} ${opts.path} ${JSON.stringify(
        opts.input,
      )}`;
      logError(originalError, requestInfo, originalError);
    }
    return result;
  } catch (cause) {
    const error = match(cause)
      .with(P.instanceOf(Error), (err) => err)
      .otherwise(() => new Error(String(cause)));
    const requestInfo = `${opts.type} ${opts.path} ${JSON.stringify(
      opts.input,
    )}`;

    logError(error, requestInfo, error);

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message,
      cause: error,
    });
  }
});

const logRequest = t.middleware(async (opts) => {
  return opts.next();
});

const { procedure: p, router: r } = t;

const procedure = p.use(logRequest).use(errorHandler);
const router = r;

export { procedure, router, eventEmitter };
