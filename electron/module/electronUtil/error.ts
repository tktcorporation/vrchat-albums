import { P, match } from 'ts-pattern';

export type FileIOErrorCode =
  | 'FILE_CREATE_FAILED'
  | 'FILE_COPY_FAILED'
  | 'FILE_DELETE_FAILED'
  | 'FILE_WRITE_FAILED'
  | 'TEMP_DIR_CREATE_FAILED'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN';

type Code = FileIOErrorCode;

/**
 * ファイルI/O操作に関するエラークラス。
 *
 * @see docs/error-handling.md - エラーハンドリング方針
 */
export class FileIOError extends Error {
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
