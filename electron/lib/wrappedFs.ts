import * as fs from 'node:fs';
import { promisify } from 'node:util';
import { err, fromThrowable, ok, type Result, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';

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
  try {
    const content = fs.readFileSync(filePath, options);
    return ok(content);
  } catch (e) {
    if (!isNodeError(e)) {
      throw e;
    }
    const error = match(e)
      .with({ code: 'ENOENT', message: P.string }, (ee) =>
        err({ code: 'ENOENT' as const, message: ee.message, error: ee }),
      )
      .otherwise(() => null);
    if (error) {
      return error;
    }
    throw e;
  }
};

export type FSError = 'ENOENT';

const readdirPromisified = promisify(fs.readdir);
type ReaddirReturn = PromiseType<ReturnType<typeof readdirPromisified>>;
/**
 * 非同期でディレクトリを読み込み、存在しない場合はエラーを返す。
 * VRChat ログ検索処理などで使用される。
 */
export const readdirAsync = async (
  ...args: Parameters<typeof readdirPromisified>
): Promise<
  Result<ReaddirReturn, { code: 'ENOENT'; error: NodeJS.ErrnoException }>
> => {
  try {
    const data = await readdirPromisified(...args);
    return ok(data);
  } catch (e) {
    if (!isNodeError(e)) {
      throw e;
    }
    const error = match(e)
      .with({ code: 'ENOENT' }, (ee) => err({ code: ee.code, error: ee }))
      .otherwise(() => null);
    if (error) {
      return error;
    }
    throw e;
  }
};

/**
 * ファイルを書き込み、失敗時には Error を Result として返す同期版ヘルパー。
 * ログ保存処理など複数箇所から利用される。
 */
const safeWriteFileSync = fromThrowable(
  (path: string, data: string | Uint8Array) => {
    fs.writeFileSync(path, data);
  },
  (e): Error => (e instanceof Error ? e : new Error(String(e))),
);

export const writeFileSyncSafe = (
  path: string,
  data: string | Uint8Array,
): Result<void, Error> => {
  return safeWriteFileSync(path, data);
};

import typeUtils from 'node:util/types';

/**
 * Node.js のエラーオブジェクトかどうかを判定するユーティリティ。
 * ファイル操作ヘルパー群から内部的に利用される。
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeUtils.isNativeError(error);
}

/**
 * ディレクトリを作成し、既に存在する場合はエラー情報を返す非同期関数。
 * VRChat 写真保存処理などで使用される。
 */
export const mkdirSyncSafe = async (
  dirPath: string,
): Promise<Result<void, { code: 'EEXIST'; error: NodeJS.ErrnoException }>> => {
  try {
    await promisify(fs.mkdir)(dirPath);
    return ok(undefined);
  } catch (e) {
    if (!isNodeError(e)) {
      throw e;
    }
    const error = match(e)
      .with({ code: 'EEXIST' }, (ee) => err({ code: ee.code, error: ee }))
      .otherwise(() => null);
    if (error) {
      return error;
    }
    throw e;
  }
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
export const appendFileAsync = async (
  ...args: Parameters<typeof appendFilePromisified>
): Promise<
  Result<AppendFileReturn, { code: 'ENOENT'; error: NodeJS.ErrnoException }>
> => {
  try {
    const data = await appendFilePromisified(...args);
    return ok(data);
  } catch (e) {
    if (!isNodeError(e)) {
      throw e;
    }
    const error = match(e).otherwise(() => null);
    if (error) {
      return error;
    }
    throw e;
  }
};

/**
 * 指定したファイルを削除する非同期関数。
 * 一時ファイルのクリーンアップ処理などで使用される。
 */
export const unlinkAsync = (path: string): ResultAsync<void, Error> => {
  return ResultAsync.fromPromise(
    fs.promises.unlink(path),
    (e): Error => (e instanceof Error ? e : new Error(String(e))),
  );
};

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
