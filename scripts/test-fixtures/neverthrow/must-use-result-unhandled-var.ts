import { ok, type Result } from 'neverthrow';

type DataError = { type: 'NOT_FOUND' };

function getData(): Result<string, DataError> {
  return ok('data');
}

// Invalid: Result is assigned to variable but never consumed
function _main() {
  const _result = getData(); // This should trigger an error
  console.log('done');
}
