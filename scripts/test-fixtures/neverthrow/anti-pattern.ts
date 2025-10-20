import { type Result, err, ok } from 'neverthrow';

type DataError = { type: 'ERROR' };

export async function loadData(): Promise<Result<string, DataError>> {
  try {
    return ok('data');
  } catch (_error) {
    // Anti-pattern: just wrapping error without classification
    return err({ type: 'ERROR' });
  }
}
