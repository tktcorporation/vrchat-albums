import { type Result, err, ok } from 'neverthrow';
import { match } from 'ts-pattern';

type DataError =
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'TIMEOUT'; message: string };

export async function loadData(): Promise<Result<string, DataError>> {
  try {
    return ok('data');
    // biome-ignore lint/suspicious/noExplicitAny: Testing error classification patterns
  } catch (error: any) {
    // Proper classification by error code
    return (
      match(error)
        // biome-ignore lint/suspicious/noExplicitAny: Testing error classification patterns
        .with({ code: 'ENOENT' }, (e: any) =>
          err({ type: 'FILE_NOT_FOUND' as const, path: e.path as string }),
        )
        // biome-ignore lint/suspicious/noExplicitAny: Testing error classification patterns
        .with({ code: 'ETIMEDOUT' }, (e: any) =>
          err({ type: 'TIMEOUT' as const, message: e.message as string }),
        )
        .otherwise((e) => {
          throw e; // Re-throw unexpected errors
        })
    );
  }
}
