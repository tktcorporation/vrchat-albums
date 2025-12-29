import { match, P } from 'ts-pattern';

type Result =
  | { type: 'success'; data: string }
  | { type: 'error'; message: string };

/**
 * Invalid: uses .otherwise() without .exhaustive()
 */
export function missingExhaustive(result: Result): string {
  return match(result)
    .with({ type: 'success' }, (r) => r.data)
    .otherwise(() => 'fallback');
}

/**
 * Another invalid case with more complex pattern
 */
export function anotherMissingExhaustive(value: unknown): string {
  return match(value)
    .with(P.string, (s) => s)
    .with(P.number, (n) => String(n))
    .otherwise(() => 'unknown');
}
