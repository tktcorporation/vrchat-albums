import { ok, type Result } from 'neverthrow';

type DataError = { type: 'NOT_FOUND' } | { type: 'TIMEOUT' };

export async function loadData(): Promise<Result<string, DataError>> {
  return ok('data');
}
