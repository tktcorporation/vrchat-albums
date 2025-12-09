import { type Result, ok } from 'neverthrow';

type DataError = { type: 'NOT_FOUND' };

// Private function - should not be checked when apply is "exported-functions"
// biome-ignore lint/correctness/noUnusedVariables: This is intentionally unused for testing
async function privateLoadData(): Promise<string> {
  return 'data';
}

// Exported function - should be checked
export async function publicLoadData(): Promise<Result<string, DataError>> {
  return ok('data');
}
