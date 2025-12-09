import { P, match } from 'ts-pattern';

export type LogInfoErrorCode =
  | 'DATABASE_QUERY_FAILED'
  | 'LOG_FILE_READ_FAILED'
  | 'UNKNOWN';

type Code = LogInfoErrorCode;

/**
 * ログ情報の処理に関するエラークラス。
 *
 * @see docs/error-handling.md - エラーハンドリング方針
 */
export class LogInfoError extends Error {
  code: Code;

  constructor(
    codeOrError:
      | Code
      | (Error & { code: Code })
      | { code: Code; message?: string },
  ) {
    const result = match(codeOrError)
      .with(P.string, (code) => ({
        message: code,
        code: code as Code,
        stack: undefined,
      }))
      .with(P.instanceOf(Error), (error) => ({
        message: error.message,
        code: error.code,
        stack: error.stack,
      }))
      .with({ code: P.string }, (obj) => ({
        message: obj.message || obj.code,
        code: obj.code as Code,
        stack: undefined,
      }))
      .otherwise(() => ({
        message: 'UNKNOWN',
        code: 'UNKNOWN' as Code,
        stack: undefined,
      }));

    super(result.message);
    this.code = result.code;
    if (result.stack) {
      this.stack = result.stack;
    }
    this.name = this.constructor.name;
  }
}
