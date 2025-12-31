// This file should trigger try-catch warning
// because it uses plain try-catch without proper patterns

import { err, ok, type Result } from 'neverthrow';

interface DataError {
  type: 'ERROR';
  message: string;
}

// This should trigger a warning - plain try-catch without classification or rethrow
export async function loadDataWithPlainTryCatch(): Promise<
  Result<string, DataError>
> {
  try {
    const data = JSON.parse('{"key": "value"}');
    return ok(data.key);
  } catch (error) {
    // No error classification, no rethrow - just wrapping
    return err({
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
