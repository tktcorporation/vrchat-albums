import * as nodeFs from 'node:fs';
import typeUtils from 'node:util/types';

import { Data, Effect } from 'effect';
import { match, P } from 'ts-pattern';

/**
 * Node.js のエラーオブジェクトかどうかを判定する。
 * fs を読み込み時に呼ばないこのモジュールに置き、wrappedFs など他のファイル操作ヘルパーからも使う。
 */
export const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeUtils.isNativeError(error);

/**
 * 存在確認そのものが失敗した（権限不足・I/O エラーなど）ことを表す。
 * 「存在しない」と区別するため、元のエラーを cause に保持する。
 */
export class PathExistenceCheckFailed extends Data.TaggedError(
  'PathExistenceCheckFailed',
)<{
  path: string;
  code: string | undefined;
  message: string;
  cause: unknown;
}> {}

/**
 * パスが存在するかを非同期に確認する。
 *
 * ENOENT / ENOTDIR だけを「存在しない」とみなす。EACCES・EPERM・EIO などを
 * 「存在しない」と読み替えると、移行・バックアップ・インポートが権限エラーを
 * 隠したまま誤った分岐に進むため、それ以外の失敗は PathExistenceCheckFailed で返す。
 *
 * node:fs をモックするテストでも読み込めるよう、fs への参照は呼び出し時まで遅らせる。
 */
export const pathExistsAsync = (
  targetPath: string,
): Effect.Effect<boolean, PathExistenceCheckFailed> =>
  Effect.tryPromise({
    try: () => nodeFs.promises.access(targetPath).then(() => true),
    catch: (error) => {
      const code = isNodeError(error) ? error.code : undefined;
      return new PathExistenceCheckFailed({
        path: targetPath,
        code,
        message: `Failed to check existence of ${targetPath}: ${String(error)}`,
        cause: error,
      });
    },
  }).pipe(
    Effect.catchTag('PathExistenceCheckFailed', (failure) =>
      match(failure.code)
        .with(P.union('ENOENT', 'ENOTDIR'), () => Effect.succeed(false))
        .otherwise(() => Effect.fail(failure)),
    ),
  );
