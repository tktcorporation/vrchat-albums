import * as neverthrow from 'neverthrow';

type DataError = { type: 'NOT_FOUND' };

// This function is in the exceptions list
export async function getAppVersion(): Promise<string> {
  return '1.0.0';
}

export async function loadData(): Promise<
  neverthrow.Result<string, DataError>
> {
  return neverthrow.ok('data');
}
