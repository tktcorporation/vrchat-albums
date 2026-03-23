import { TRPCError } from '@trpc/server';
import { Data, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runEffect, runEffectExit } from './effectTRPC';
import { ERROR_CATEGORIES, ERROR_CODES, UserFacingError } from './errors';

describe('runEffect', () => {
  describe('成功パス', () => {
    it('Effect が成功した場合、値を返す', async () => {
      const result = await runEffect(Effect.succeed(42));
      expect(result).toBe(42);
    });

    it('null を返す Effect も正常に処理する', async () => {
      const result = await runEffect(Effect.succeed(null));
      expect(result).toBeNull();
    });
  });

  describe('typed error パス（UserFacingError）', () => {
    it('E チャネルの UserFacingError を TRPCError.cause に格納して throw する', async () => {
      const userFacingError = UserFacingError.withStructuredInfo({
        code: ERROR_CODES.DATABASE_ERROR,
        category: ERROR_CATEGORIES.DATABASE_ERROR,
        message: 'db failed',
        userMessage: 'DB エラーが発生しました。',
      });

      try {
        await runEffect(Effect.fail(userFacingError));
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const trpcError = error as TRPCError;
        expect(trpcError.cause).toBeInstanceOf(UserFacingError);
        expect(trpcError.cause).toBe(userFacingError);
        expect(trpcError.message).toBe('DB エラーが発生しました。');
      }
    });

    it('UserFacingError の cause が保持されている場合、Sentry 送信用に利用可能', async () => {
      const originalError = new Error('connection refused');
      const userFacingError = UserFacingError.withStructuredInfo({
        code: ERROR_CODES.DATABASE_ERROR,
        category: ERROR_CATEGORIES.DATABASE_ERROR,
        message: 'db connection failed',
        userMessage: 'DB エラーが発生しました。',
        cause: originalError,
      });

      try {
        await runEffect(Effect.fail(userFacingError));
        expect.unreachable('should have thrown');
      } catch (error) {
        const trpcError = error as TRPCError;
        const ufe = trpcError.cause as UserFacingError;
        expect(ufe.errorInfo?.cause).toBe(originalError);
      }
    });
  });

  describe('defect パス（予期しないエラー）', () => {
    it('Effect.die のエラーをそのまま re-throw する', async () => {
      const unexpectedError = new Error('memory exhausted');

      try {
        await runEffect(
          Effect.die(unexpectedError) as Effect.Effect<never, UserFacingError>,
        );
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBe(unexpectedError);
        expect(error).not.toBeInstanceOf(TRPCError);
      }
    });
  });

  describe('interrupt パス', () => {
    it('interrupt の場合は汎用エラーを throw する', async () => {
      await expect(
        runEffect(Effect.interrupt as Effect.Effect<never, UserFacingError>),
      ).rejects.toThrow('Effect was interrupted');
    });
  });
});

class TestDatabaseError extends Data.TaggedError('TestDatabaseError')<{
  readonly message: string;
}> {}

class TestNotFoundError extends Data.TaggedError('TestNotFoundError')<{
  readonly message: string;
}> {}

type TestError = TestDatabaseError | TestNotFoundError;

describe('runEffectExit', () => {
  describe('成功パス', () => {
    it('Effect が成功した場合、{ success: true, value } を返す', async () => {
      const result = await runEffectExit(Effect.succeed(42));
      expect(result).toEqual({ success: true, value: 42 });
    });

    it('null を返す Effect も正常に処理する', async () => {
      const result = await runEffectExit(Effect.succeed(null));
      expect(result).toEqual({ success: true, value: null });
    });
  });

  describe('typed error パス', () => {
    it('E チャネルのエラーを { success: false, error } として返す', async () => {
      const error = new TestDatabaseError({ message: 'db failed' });
      const result = await runEffectExit<number, TestError>(Effect.fail(error));
      expect(result).toEqual({ success: false, error });
    });

    it('エラーの _tag でパターンマッチできる', async () => {
      const error = new TestNotFoundError({ message: 'not found' });
      const result = await runEffectExit<number, TestError>(Effect.fail(error));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error._tag).toBe('TestNotFoundError');
      }
    });
  });

  describe('defect パス（予期しないエラー）', () => {
    it('Effect.die のエラーをそのまま re-throw する', async () => {
      const unexpectedError = new Error('memory exhausted');

      try {
        await runEffectExit(
          Effect.die(unexpectedError) as Effect.Effect<never, TestError>,
        );
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBe(unexpectedError);
      }
    });
  });

  describe('interrupt パス', () => {
    it('interrupt の場合は汎用エラーを throw する', async () => {
      await expect(
        runEffectExit(Effect.interrupt as Effect.Effect<never, TestError>),
      ).rejects.toThrow('Effect was interrupted');
    });
  });
});
