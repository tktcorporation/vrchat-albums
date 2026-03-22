/**
 * Effect TS と tRPC の統合ヘルパー
 *
 * Effect<T, UserFacingError> を tRPC procedure 内で実行し、
 * E チャネルのエラーを TRPCError に変換する唯一の実行境界。
 *
 * 背景: Effect の E チャネルで型安全にエラーを伝播し、
 * tRPC 境界でのみ TRPCError に変換することで、
 * FiberFailure 問題（Effect.runPromise が E チャネルのエラーを
 * FiberFailure に包み、findUserFacingError が発見できない）を解決する。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { TRPCError } from '@trpc/server';
import { Cause, Effect, Exit, Option } from 'effect';
import type { UserFacingError } from './errors';

/**
 * Effect<T, UserFacingError> を tRPC procedure 内で実行する。
 *
 * 型制約により、呼び出し側は Effect.catchTag / Effect.mapError で
 * すべてのドメインエラーを UserFacingError に変換してから渡す必要がある。
 * 未変換のドメインエラーが残っていると**コンパイルエラー**になる。
 *
 * エラー処理:
 * - E チャネルの UserFacingError → TRPCError.cause に格納して throw
 *   → tRPC の errorFormatter の findUserFacingError が発見
 *   → logError が Toast を emit
 * - Defect（予期しないエラー）→ そのまま re-throw（Sentry 送信）
 * - Interrupt → 汎用エラーを throw
 *
 * Cause が Sequential/Parallel の場合（Effect.all 等で複数エラーが
 * 並列発生した場合）、最初のエラーのみ処理する。
 */
export async function runEffect<T>(
  effect: Effect.Effect<T, UserFacingError>,
): Promise<T> {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  // E チャネルの UserFacingError → TRPCError.cause に格納
  const failOpt = Cause.failureOption(exit.cause);
  if (Option.isSome(failOpt)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: failOpt.value.message,
      cause: failOpt.value,
    });
  }

  // Defect（予期しないエラー）→ そのまま re-throw して Sentry で捕捉
  const dieOpt = Cause.dieOption(exit.cause);
  if (Option.isSome(dieOpt)) {
    throw dieOpt.value;
  }

  throw new Error('Effect was interrupted or failed with an unknown cause');
}

/**
 * Effect を実行し、型付きエラー（E チャネル）を呼び出し側で処理可能な形で返す。
 *
 * 背景: runEffect は E チャネルのエラーを TRPCError に変換するが、
 * コントローラー層ではエラー型を検査してから分岐したい場合がある
 * （例: エラー種別により null を返すか UserFacingError を投げるか決める）。
 * その場合に Exit/Cause/failureOption/dieOption のボイラープレートを
 * 毎回手書きするのはエラーハンドリング漏れ（dieOption や interrupt の忘れ）のリスクがある。
 *
 * この関数は Defect と Interrupt を自動的に処理し、
 * 呼び出し側は成功値と型付きエラーのみを扱えばよい。
 *
 * @returns 成功時は `{ success: true, value: T }`, 型付きエラー時は `{ success: false, error: E }`
 * @throws Defect（予期しないエラー）はそのまま re-throw（Sentry 送信）
 * @throws Interrupt は汎用エラーとして throw
 */
export async function runEffectExit<T, E>(
  effect: Effect.Effect<T, E>,
): Promise<{ success: true; value: T } | { success: false; error: E }> {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return { success: true, value: exit.value };
  }

  const failOpt = Cause.failureOption(exit.cause);
  if (Option.isSome(failOpt)) {
    return { success: false, error: failOpt.value };
  }

  // Defect（予期しないエラー）→ そのまま re-throw して Sentry で捕捉
  const dieOpt = Cause.dieOption(exit.cause);
  if (Option.isSome(dieOpt)) {
    throw dieOpt.value;
  }

  throw new Error('Effect was interrupted or failed with an unknown cause');
}
