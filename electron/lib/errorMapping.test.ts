import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  mapByTag,
  mapToFileOperationError,
  mapToOpenPathError,
  mapToUnknownError,
  toError,
  toUserFacing,
} from './errorMapping';
import { ERROR_CATEGORIES, ERROR_CODES, UserFacingError } from './errors';

describe('toError', () => {
  it('Error はそのまま返す', () => {
    const original = new Error('boom');
    expect(toError(original)).toBe(original);
  });

  it('文字列は Error にラップする', () => {
    const result = toError('boom');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('boom');
  });

  it('オブジェクトは toString で文字列化', () => {
    const result = toError({ foo: 'bar' });
    expect(result).toBeInstanceOf(Error);
  });
});

describe('toUserFacing', () => {
  it('指定したコード/カテゴリ/ユーザーメッセージで変換する', () => {
    const map = toUserFacing<{ message: string }>({
      code: ERROR_CODES.DATABASE_ERROR,
      category: ERROR_CATEGORIES.DATABASE_ERROR,
      userMessage: 'DBエラー',
    });

    const result = map({ message: 'connection failed' });

    expect(result).toBeInstanceOf(UserFacingError);
    expect(result.code).toBe(ERROR_CODES.DATABASE_ERROR);
    expect(result.category).toBe(ERROR_CATEGORIES.DATABASE_ERROR);
    expect(result.userMessage).toBe('DBエラー');
    expect(result.errorInfo?.message).toBe('DBエラー (connection failed)');
  });

  it('userMessage を関数で動的生成できる', () => {
    const map = toUserFacing<{ message: string }>({
      userMessage: (e) => `アップデートに失敗しました: ${e.message}`,
    });

    const result = map({ message: 'network down' });

    expect(result.userMessage).toBe('アップデートに失敗しました: network down');
  });

  it('cause に元エラーを保持する', () => {
    const original = new Error('原因');
    const map = toUserFacing<Error>({ userMessage: 'X' });

    const result = map(original);

    expect(result.errorInfo?.cause).toBe(original);
  });

  it('Effect.mapError と組み合わせて E チャネルを変換できる', async () => {
    const failing = Effect.fail<{ message: string }>({ message: 'x' });
    const mapped = failing.pipe(
      Effect.mapError(toUserFacing<{ message: string }>({ userMessage: 'Y' })),
    );

    const exit = await Effect.runPromiseExit(mapped);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('プリセットマッパー', () => {
  it('mapToFileOperationError は UNKNOWN/UNKNOWN_ERROR で「ファイル操作中…」', () => {
    const result = mapToFileOperationError({ message: 'EACCES' });

    expect(result.code).toBe(ERROR_CODES.UNKNOWN);
    expect(result.category).toBe(ERROR_CATEGORIES.UNKNOWN_ERROR);
    expect(result.userMessage).toBe('ファイル操作中にエラーが発生しました。');
  });

  it('mapToOpenPathError は FILE_NOT_FOUND で「ファイルを開けませんでした」', () => {
    const result = mapToOpenPathError({ message: 'no such path' });

    expect(result.code).toBe(ERROR_CODES.FILE_NOT_FOUND);
    expect(result.category).toBe(ERROR_CATEGORIES.FILE_NOT_FOUND);
    expect(result.userMessage).toBe('ファイルを開けませんでした。');
  });

  it('mapToUnknownError は userMessage を任意指定可能', () => {
    const map = mapToUnknownError('画像生成中にエラーが発生しました。');
    const result = map({ message: 'svg parse error' });

    expect(result.userMessage).toBe('画像生成中にエラーが発生しました。');
  });
});

describe('mapByTag', () => {
  type SyncError =
    | { _tag: 'LogFileDirNotFound'; message: string }
    | { _tag: 'LogFilesNotFound'; message: string }
    | { _tag: 'GenericError'; message: string };

  const map = mapByTag<SyncError>(
    {
      LogFileDirNotFound: () =>
        UserFacingError.withStructuredInfo({
          code: ERROR_CODES.VRCHAT_DIRECTORY_SETUP_REQUIRED,
          category: ERROR_CATEGORIES.SETUP_REQUIRED,
          message: 'dir not found',
          userMessage: 'ディレクトリ未設定',
        }),
      LogFilesNotFound: () =>
        UserFacingError.withStructuredInfo({
          code: ERROR_CODES.FILE_NOT_FOUND,
          category: ERROR_CATEGORIES.FILE_NOT_FOUND,
          message: 'files not found',
          userMessage: 'ファイル未検出',
        }),
    },
    mapToUnknownError('ログ同期中にエラーが発生しました。'),
  );

  it('登録した tag は対応する変換が呼ばれる', () => {
    const result = map({ _tag: 'LogFileDirNotFound', message: 'm' });
    expect(result.code).toBe(ERROR_CODES.VRCHAT_DIRECTORY_SETUP_REQUIRED);
    expect(result.userMessage).toBe('ディレクトリ未設定');
  });

  it('未登録の tag は fallback が呼ばれる', () => {
    const result = map({ _tag: 'GenericError', message: 'oops' });
    expect(result.code).toBe(ERROR_CODES.UNKNOWN);
    expect(result.userMessage).toBe('ログ同期中にエラーが発生しました。');
  });

  it('fallback 省略時はデフォルトの「予期しないエラー」', () => {
    const mapNoFallback = mapByTag<SyncError>({});
    const result = mapNoFallback({ _tag: 'GenericError', message: 'x' });
    expect(result.userMessage).toBe('予期しないエラーが発生しました。');
  });
});
