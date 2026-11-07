import { Effect, Result } from 'effect';
// electron-log は読み込んだプロセスに合わせて実装を選ぶ。main（process.type が 'browser'）では
// Electron の app を使う版、utilityProcess とテストでは Node だけで動く版になる
import * as log from 'electron-log';
import path from 'pathe';
import { stackWithCauses } from 'pony-cause';
import { match, P } from 'ts-pattern';

import { withElectronApp } from './electronModules';
import { UserFacingError } from './errors';

/**
 * logger を読み込んだプロセス。
 *
 * 処理本体（utilityProcess）には Electron の `app` が無く、ログの保存先は main から起動時に届く。
 * 届くまではファイルへ書かず（標準出力は main がログへ流す）、`configureBackendLogFile` で保存先を受け取ってから書く。
 * 保存先を推測すると、届く前のログだけが別の場所に残る。
 */
const isBackendProcess = process.type === 'utility';

/** main とテストでのファイルの保存先。テストでは Electron の app が無いので、このディレクトリへ書く */
const defaultLogFilePath = withElectronApp(
  path.join(__dirname, 'test-app.log'),
  (app) => path.join(app.getPath('logs'), 'app.log'),
);

const applyLevels = (isProduction: boolean): void => {
  log.transports.file.level = isProduction ? 'info' : 'debug';
  log.transports.console.level = isProduction ? 'warn' : 'debug';
};

// ファイルサイズの上限設定（例: 5MB）
log.transports.file.maxSize = 5 * 1024 * 1024;

// ログフォーマットの設定
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';
log.transports.console.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';

if (isBackendProcess) {
  log.transports.file.level = false;
  log.transports.console.level = 'debug';
} else {
  log.transports.file.resolvePathFn = () => defaultLogFilePath;
  applyLevels(withElectronApp(false, (app) => app.isPackaged));
}

/**
 * 処理本体（utilityProcess）のログの保存先を決め、ファイルへの書き込みを始める。
 *
 * 処理本体の入口（`electron/backend/main.ts`）が、main から起動時の情報を受け取った直後に 1 度だけ呼ぶ。
 * main の `app.log` とは別のファイルにする。2 つのプロセスが同じファイルへ書くと、
 * それぞれのローテーションが相手の書き込みを消しうるため。
 */
export const configureBackendLogFile = (options: {
  readonly logsDir: string;
  readonly isPackaged: boolean;
}): void => {
  const filePath = path.join(options.logsDir, 'backend.log');
  log.transports.file.resolvePathFn = () => filePath;
  applyLevels(options.isPackaged);
};

/** エラー監視へ送るときに添える情報。Sentry の CaptureContext のうち、logger が使う部分 */
interface ReportContext {
  readonly extra: Record<string, unknown>;
  readonly tags: Record<string, string>;
}

/**
 * logger がエラー監視へ送るときに使う、プロセスごとの送り先。
 *
 * Sentry の SDK はプロセスごとに入口が違う（main は `@sentry/electron/main`、処理本体は
 * `@sentry/electron/utility`）。logger が一方を直接読み込むと、もう一方のプロセスで読み込めない
 * （main 用の SDK は Electron の app を前提にする）。各プロセスの入口が自分の SDK を渡す。
 */
export interface ErrorReporter {
  /** Sentry の tags の `source` に入れる、送り元のプロセスの名前 */
  readonly source: string;
  /** 利用者が規約に同意しているか。同意していなければ送らない */
  isTermsAccepted(): boolean;
  captureException(error: Error, context: ReportContext): unknown;
  captureMessage(
    message: string,
    context: ReportContext & { readonly level: 'warning' },
  ): unknown;
}

let errorReporter: ErrorReporter | null = null;

/**
 * logger の送り先を登録する。各プロセスの入口が、エラーを記録しうる処理を始める前に呼ぶ。
 * 登録するまでは、エラーをファイルと標準出力にだけ残し、エラー監視へは送らない。
 */
export const configureErrorReporting = (reporter: ErrorReporter): void => {
  errorReporter = reporter;
};

interface ErrorLogParams {
  message: unknown;
  stack?: Error;
  details?: Record<string, unknown>;
  /**
   * Sentry の tags に追加するフィールド（フィルタ・グルーピングに使う低カーディナリティな値向け）。
   * source は常にこの関数側の値で上書きする（呼び出し元からは変更不可、下記マージ順）。
   */
  tags?: Record<string, string>;
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
      const errorInfo = Object.create(
        Object.getPrototypeOf(baseError) as object | null,
      ) as Error;
      Object.assign(errorInfo, baseError, {
        name: baseError.name,
        message: baseError.message,
        stack: s.stack,
        cause: baseError.cause ?? s,
      });

      return errorInfo;
    });
};

const info: typeof log.info = log.info.bind(log);
const debug: typeof log.debug = log.debug.bind(log);
const warn: typeof log.warn = log.warn.bind(log);

/**
 * 同期処理が投げた例外を Result の失敗として返すヘルパー。
 * logger は Sentry 送信の失敗でログ出力自体を止めないよう、例外を値として扱う。
 */
const trySyncResult = <A>(fn: () => A): Result.Result<A, unknown> => {
  return Effect.runSync(
    Effect.result(Effect.try({ try: fn, catch: (e) => e })),
  );
};

/**
 * 送ってよい送り先を返す。送り先が未登録か、利用者が規約に同意していなければ null。
 * 同意の確認（設定ファイルの読み出し）が失敗しても、ログの出力は止めずに送らない側へ倒す。
 */
const acceptedReporter = (): ErrorReporter | null => {
  const reporter = errorReporter;
  if (reporter === null) {
    log.debug('Error reporting is not configured, skipping Sentry');
    return null;
  }
  const termsResult = trySyncResult(() => reporter.isTermsAccepted());
  const accepted = Result.match(termsResult, {
    onSuccess: (value) => value,
    onFailure: (termsError) => {
      log.warn('Failed to get terms accepted:', termsError);
      return false;
    },
  });
  return accepted ? reporter : null;
};

/**
 * ローカルログ出力に加え、Sentry に warning レベルで送信するラッパー関数。
 *
 * 背景: logger.warn はローカルログのみだが、一部の警告はプロダクション環境で
 * Sentry 追跡が必要。logger.error ほど深刻ではないが監視したいイベント向け。
 * 不要になれば個別の呼び出し元を logger.warn に戻して削除可能。
 *
 * 呼び出し元: VRChat API失敗、ログ処理の部分的失敗、ディレクトリ読み取り失敗など
 */
const warnWithSentry = ({ message, stack, details }: ErrorLogParams): void => {
  const messageString = match(message)
    .with(P.instanceOf(Error), (e) => e.message)
    .otherwise(String);

  // ローカルログ出力
  log.warn(
    messageString,
    ...(stack ? [stackWithCauses(stack)] : []),
    ...(details ? [details] : []),
  );

  match(acceptedReporter())
    .with(P.nonNullable, (reporter) => {
      log.debug('Attempting to send warning to Sentry...');
      const sendResult = trySyncResult(() => {
        reporter.captureMessage(messageString, {
          level: 'warning',
          extra: {
            ...(stack ? { stack: stackWithCauses(stack) } : {}),
            ...(details ? { details } : {}),
          },
          tags: {
            source: reporter.source,
          },
        });
      });
      Result.match(sendResult, {
        onSuccess: () => log.debug('Warning sent to Sentry successfully'),
        onFailure: (sentryError) =>
          log.debug('Failed to send warning to Sentry:', sentryError),
      });
    })
    .with(null, () => {
      log.debug('Terms not accepted, skipping Sentry warning');
    })
    .exhaustive();
};

/**
 * Sentry への送信も行うエラー出力用ラッパー関数。
 */
const error = ({ message, stack, details, tags }: ErrorLogParams): void => {
  const normalizedError = normalizeError(message);
  const errorInfo = buildErrorInfo({ message, stack });

  // ログ出力
  log.error(
    stackWithCauses(normalizedError),
    ...(stack ? [stackWithCauses(stack)] : []),
    ...(details ? [details] : []),
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
  match({ reporter: acceptedReporter(), shouldSendToSentry })
    .with(
      { reporter: P.nonNullable, shouldSendToSentry: true },
      ({ reporter }) => {
        log.debug('Attempting to send error to Sentry...');
        // UserFacingErrorの場合はcauseを送信、それ以外は元のエラーを送信
        const errorToSend = causeError ?? errorInfo;
        const sendResult = trySyncResult(() => {
          reporter.captureException(errorToSend, {
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
              ...tags,
              source: reporter.source,
              ...(userFacingError ? { hasUserFacingWrapper: 'true' } : {}),
            },
          });
        });
        Result.match(sendResult, {
          onSuccess: () =>
            log.debug(
              `Error sent to Sentry successfully${causeError ? ' (cause from UserFacingError)' : ''}`,
            ),
          onFailure: (sentryError) =>
            log.debug('Failed to send error to Sentry:', sentryError),
        });
      },
    )
    .with({ reporter: P.nonNullable, shouldSendToSentry: false }, () => {
      log.debug(
        'UserFacingError without cause detected, skipping Sentry (handled error)',
      );
    })
    .with({ reporter: null }, () => {
      log.debug('Terms not accepted, skipping Sentry error');
    })
    .exhaustive();
};

const logger = {
  info,
  debug,
  error,
  warn,
  warnWithSentry,
  transports: {
    file: log.transports.file,
    console: log.transports.console,
  },
  setTransportsLevel: (level: log.LevelOption) => {
    log.transports.file.level = level;
    log.transports.console.level = level;
  },
};

export { logger };
