import * as fs from 'node:fs';
import { promisify } from 'node:util';
import typeUtils from 'node:util/types';
import { fromThrowable, type Result, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';

/**
 * Node.js のエラーオブジェクトかどうかを判定するユーティリティ。
 * ファイル操作ヘルパー群から内部的に利用される。
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeUtils.isNativeError(error);
}

/**
 * 同期的にファイルを読み込み、存在しない場合はエラー情報を返す。
 * ログ処理など複数のサービスから利用される。
 */
export const readFileSyncSafe = (
  filePath: string,
  options?: { encoding?: null; flag?: string } | null,
): Result<
  Buffer,
  { code: 'ENOENT' | string; message: string; error: Error }
> => {
  const safeRead = fromThrowable(
    () => fs.readFileSync(filePath, options),
    (e): { code: 'ENOENT' | string; message: string; error: Error } => {
      if (!isNodeError(e)) {
        throw e; // 予期しないエラーをre-throw
      }
      return match(e)
        .with({ code: 'ENOENT', message: P.string }, (ee) => ({
          code: 'ENOENT' as const,
          message: ee.message,
          error: ee,
        }))
        .otherwise((ee) => {
          throw ee; // 分類できないエラーをre-throw
        });
    },
  );
  return safeRead();
};

export type FSError = 'ENOENT';

const readdirPromisified = promisify(fs.readdir);
type ReaddirReturn = PromiseType<ReturnType<typeof readdirPromisified>>;
/**
 * 非同期でディレクトリを読み込み、存在しない場合はエラーを返す。
 * VRChat ログ検索処理などで使用される。
 */
export const readdirAsync = (
  ...args: Parameters<typeof readdirPromisified>
): ResultAsync<
  ReaddirReturn,
  { code: 'ENOENT'; error: NodeJS.ErrnoException }
> =>
  ResultAsync.fromPromise(
    readdirPromisified(...args),
    (e): { code: 'ENOENT'; error: NodeJS.ErrnoException } => {
      if (!isNodeError(e)) {
        throw e; // 予期しないエラーをre-throw
      }
      return match(e)
        .with({ code: 'ENOENT' }, (ee) => ({ code: ee.code, error: ee }))
        .otherwise((ee) => {
          throw ee; // 分類できないエラーをre-throw
        });
    },
  );

/**
 * ファイル書き込みエラー型
 */
export type WriteFileError =
  | { type: 'ENOENT'; message: string }
  | { type: 'EACCES'; message: string }
  | { type: 'ENOSPC'; message: string }
  | { type: 'IO_ERROR'; message: string; code?: string };

/**
 * ファイルを書き込み、失敗時には具体的なエラー型を返す同期版ヘルパー。
 * ログ保存処理など複数箇所から利用される。
 */
export const writeFileSyncSafe = (
  path: string,
  data: string | Uint8Array,
): Result<void, WriteFileError> => {
  const safeWrite = fromThrowable(
    () => fs.writeFileSync(path, data),
    (e): WriteFileError => {
      if (!isNodeError(e)) {
        throw e; // 予期しないエラーはre-throw（Sentry通知）
      }
      return match(e)
        .with({ code: 'ENOENT' }, (ee) => ({
          type: 'ENOENT' as const,
          message: ee.message,
        }))
        .with({ code: 'EACCES' }, (ee) => ({
          type: 'EACCES' as const,
          message: ee.message,
        }))
        .with({ code: 'ENOSPC' }, (ee) => ({
          type: 'ENOSPC' as const,
          message: ee.message,
        }))
        .otherwise((ee) => ({
          type: 'IO_ERROR' as const,
          message: ee.message,
          code: ee.code,
        }));
    },
  );
  return safeWrite();
};

/**
 * fs.existsSync の薄いラッパー
 * ログ保存処理などでファイルの存在確認に利用される
 */
export const existsSyncSafe = (path: string): boolean => {
  return fs.existsSync(path);
};

type PromiseType<T extends PromiseLike<unknown>> =
  T extends PromiseLike<infer P> ? P : never;

const appendFilePromisified = promisify(fs.appendFile);
type AppendFileReturn = PromiseType<ReturnType<typeof appendFilePromisified>>;
/**
 * ファイル末尾にデータを追記する非同期関数。
 * ログファイル更新処理で利用される。
 */
export const appendFileAsync = (
  ...args: Parameters<typeof appendFilePromisified>
): ResultAsync<
  AppendFileReturn,
  { code: 'ENOENT'; error: NodeJS.ErrnoException }
> =>
  ResultAsync.fromPromise(
    appendFilePromisified(...args),
    (e): { code: 'ENOENT'; error: NodeJS.ErrnoException } => {
      if (!isNodeError(e)) {
        throw e; // 予期しないエラーをre-throw
      }
      return match(e)
        .with({ code: 'ENOENT' }, (ee) => ({ code: ee.code, error: ee }))
        .otherwise((ee) => {
          throw ee; // 分類できないエラーをre-throw
        });
    },
  );

/**
 * fs.createReadStream をラップしたユーティリティ。
 * 大きなファイルをストリームとして処理する際に利用される。
 */
export const createReadStream = (
  filePath: string,
  options?: Parameters<typeof fs.createReadStream>[1],
): fs.ReadStream => {
  return fs.createReadStream(filePath, options);
};
