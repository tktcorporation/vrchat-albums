import { match, P } from 'ts-pattern';

export type VRChatLogFileErrorCode =
  | 'LOG_FILE_NOT_FOUND'
  | 'LOG_FILE_DIR_NOT_FOUND'
  | 'LOG_FILES_NOT_FOUND'
  | 'LOG_STORE_DIR_CREATE_FAILED'
  | 'LOG_MONTH_DIR_CREATE_FAILED'
  | 'LOG_FILE_WRITE_FAILED'
  | 'LOG_PARSE_ERROR'
  | 'UNKNOWN';

type Code = VRChatLogFileErrorCode;

/**
 * VRChatログファイル読み込みに関するエラークラス。
 *
 * @see docs/error-handling.md - エラーハンドリング方針
 * @see electron/module/vrchatLog/fileHandlers - ログ読み込み関連
 */
export class VRChatLogFileError extends Error {
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
