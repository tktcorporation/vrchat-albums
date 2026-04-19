/**
 * Effect.mapError と組み合わせる UserFacingError 変換ヘルパー
 *
 * 背景: コントローラー層で
 * `Effect.mapError(e => UserFacingError.withStructuredInfo({ code, category, message, userMessage, cause: ... }))`
 * のボイラープレートが各 tRPC ルーターで重複していた。
 * SSOT 化することで「同じユーザーメッセージが複数箇所に散在 → メッセージ修正漏れ」のリスクを排除する。
 *
 * 使い分け:
 * - 単一エラー型を変換: `toUserFacing()` / プリセット (`mapToFileOperationError` 等)
 * - 複数 tag を分岐: `mapByTag()`（ts-pattern の `match` + `_tag` 判定をラップ）
 *
 * @see electron/lib/errors.ts - UserFacingError 定義
 * @see electron/lib/effectTRPC.ts - runEffect (tRPC 実行境界)
 */

import {
  ERROR_CATEGORIES,
  type ErrorCategory,
  ERROR_CODES,
  type ErrorCode,
  UserFacingError,
} from './errors';

/**
 * 任意の値からメッセージ文字列を取り出す。
 *
 * `{ message: string }` を持つオブジェクトはそのプロパティを、
 * 文字列はそのまま、それ以外は `String()` で変換する。
 *
 * `e.message` が `undefined` のケースで `"undefined"` 文字列が
 * 表示に紛れ込まないよう、string 以外は `String(e)` にフォールバックする。
 */
const extractErrorMessage = (e: unknown): string => {
  if (typeof e === 'string') {
    return e;
  }
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message;
    if (typeof msg === 'string') {
      return msg;
    }
  }
  return String(e);
};

/**
 * 任意の値を Error に正規化する。
 *
 * UserFacingError の `cause` にスタックトレースを残すため、
 * Error 以外（string、Tagged Error の plain object など）はラップする。
 * Tagged Error の plain object でも `message` フィールドを保持するため、
 * `extractErrorMessage` 経由で意味のあるメッセージを抜き出して Error 化する
 * (旧 `String(e)` だと `[object Object]` になりメッセージが失われていた)。
 */
export const toError = (e: unknown): Error =>
  e instanceof Error ? e : new Error(extractErrorMessage(e));

/**
 * `toUserFacing` のオプション。
 *
 * `userMessage` / `message` を関数で受けることで、
 * 元エラーの内容を埋め込んだメッセージ生成（例: `アップデートに失敗しました: ${e.message}`）に対応する。
 *
 * E は任意の型を許容する（string literal の Tagged Error も含む）。
 */
export interface UserFacingFactoryOptions<E> {
  code?: ErrorCode;
  category?: ErrorCategory;
  /** ユーザー向けメッセージ。文字列 or 元エラーから生成する関数 */
  userMessage: string | ((e: E) => string);
  /**
   * 内部 message（Sentry/ログ用）。省略時は元エラーの `message` プロパティ (=`e.message`) を
   * そのまま使う。旧コードの `message: e.message` 相当を維持するためのデフォルト。
   */
  message?: string | ((e: E) => string);
}

/**
 * `Effect.mapError` 用の UserFacingError 変換ファクトリ。
 *
 * @example
 * ```typescript
 * const mapMyError = toUserFacing<MyError>({
 *   code: ERROR_CODES.DATABASE_ERROR,
 *   category: ERROR_CATEGORIES.DATABASE_ERROR,
 *   userMessage: 'データの取得に失敗しました。',
 * });
 *
 * service.getData().pipe(Effect.mapError(mapMyError));
 * ```
 */
const resolveTemplate = <E>(
  template: string | ((e: E) => string) | undefined,
  fallback: string,
  e: E,
): string => {
  if (template === undefined) {
    return fallback;
  }
  if (typeof template === 'string') {
    return template;
  }
  return template(e);
};

export const toUserFacing =
  <E>(opts: UserFacingFactoryOptions<E>) =>
  (e: E): UserFacingError => {
    const userMessage = resolveTemplate(opts.userMessage, '', e);
    // 旧コード互換のため message のデフォルトは raw `e.message`
    // （内部ログや Sentry で元のエラー文面を失わないため）
    const errorMessage = extractErrorMessage(e);
    const message = resolveTemplate(opts.message, errorMessage, e);
    return UserFacingError.withStructuredInfo({
      code: opts.code ?? ERROR_CODES.UNKNOWN,
      category: opts.category ?? ERROR_CATEGORIES.UNKNOWN_ERROR,
      message,
      userMessage,
      cause: toError(e),
    });
  };

/**
 * 汎用ファイル操作エラー → UserFacingError。
 *
 * `electronUtilController` / `api.ts` の openPathOnExplorer 等で重複していた
 * 「ファイル操作中にエラーが発生しました。」のマッパー。
 */
export const mapToFileOperationError = toUserFacing<{ message: string }>({
  userMessage: 'ファイル操作中にエラーが発生しました。',
});

/**
 * パスオープン失敗エラー → UserFacingError。
 *
 * `OpenPathFailed` を「ファイルを開けませんでした」として表示する用途。
 * `electronUtilController` で重複していたパターン。
 */
export const mapToOpenPathError = toUserFacing<{ message: string }>({
  code: ERROR_CODES.FILE_NOT_FOUND,
  category: ERROR_CATEGORIES.FILE_NOT_FOUND,
  userMessage: 'ファイルを開けませんでした。',
});

/**
 * 汎用 UNKNOWN エラー → UserFacingError ファクトリ。
 *
 * `userMessage` だけ指定したい場合のショートハンド。
 * `imageGeneratorController` / `vrchatLogController` 等のドメイン固有マッパーから利用。
 *
 * @example
 * ```typescript
 * const mapImageGenerationError = mapToUnknownError(
 *   '画像生成中にエラーが発生しました。',
 * );
 * ```
 */
export const mapToUnknownError = (
  userMessage: string,
): (<E>(e: E) => UserFacingError) => toUserFacing({ userMessage });

/**
 * Tagged Error の `_tag` で分岐し、対応するユーザーメッセージに変換する。
 *
 * `logSyncController` のように複数の Tagged Error をまとめて変換する箇所で、
 * `match(e._tag).with(...).otherwise(...)` のボイラープレートを排除する。
 *
 * 対応するエラー型: `Data.TaggedError` 由来の `_tag: string` を持つもの。
 * `_tag` は optional で受け、未定義のエラー（旧来の `Error` 派生クラスや
 * `code` フィールドのみのエラー）は自動で `fallback` に流れる。
 * その種のエラーを個別分岐したい場合は `match(e).with({ code: 'X' }, ...)` のような
 * 専用ハンドラを別途用意するか、まずエラー型を `Data.TaggedError` に移行すること。
 *
 * @param patterns - `_tag` をキーとした変換関数のマップ。未列挙の tag は `fallback` が処理。
 * @param fallback - patterns に一致しなかった場合のデフォルト変換。省略時は UNKNOWN/UNKNOWN_ERROR。
 *
 * @example
 * ```typescript
 * const mapSyncError = mapByTag<MySyncError>({
 *   LogFileDirNotFound: () => UserFacingError.withStructuredInfo({...}),
 *   LogFilesNotFound: () => UserFacingError.withStructuredInfo({...}),
 * }, mapToUnknownError('ログ同期中にエラーが発生しました。'));
 * ```
 */
export const mapByTag =
  <E extends { _tag?: string; message: string }>(
    patterns: Partial<
      Record<NonNullable<E['_tag']>, (e: E) => UserFacingError>
    >,
    fallback: (e: E) => UserFacingError = mapToUnknownError(
      '予期しないエラーが発生しました。',
    ),
  ) =>
  (e: E): UserFacingError => {
    // 型上は `Partial<Record<NonNullable<E['_tag']>, ...>>` だが、
    // ランタイムでは任意の string キーで lookup したいため一度緩めて参照する
    const handler =
      typeof e._tag === 'string'
        ? (patterns as Record<string, ((e: E) => UserFacingError) | undefined>)[
            e._tag
          ]
        : undefined;
    return handler ? handler(e) : fallback(e);
  };
