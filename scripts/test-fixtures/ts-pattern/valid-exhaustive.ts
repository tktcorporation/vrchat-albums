import { match } from 'ts-pattern';

type Result =
  | { type: 'success'; data: string }
  | { type: 'error'; message: string };

/**
 * Valid: uses .exhaustive() before .otherwise()
 */
export function validWithExhaustive(result: Result): string {
  return match(result)
    .with({ type: 'success' }, (r) => r.data)
    .with({ type: 'error' }, (r) => r.message)
    .exhaustive();
}

/**
 * Also valid: just .exhaustive() without .otherwise()
 */
export function validExhaustiveOnly(result: Result): string {
  return match(result)
    .with({ type: 'success' }, (r) => r.data)
    .with({ type: 'error' }, (r) => r.message)
    .exhaustive();
}
