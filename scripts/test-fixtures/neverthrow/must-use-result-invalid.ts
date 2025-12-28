import { ok, type Result } from 'neverthrow';

type DataError = { type: 'NOT_FOUND' };

function getData(): Result<string, DataError> {
  return ok('data');
}

// Invalid: Result is not consumed
function _main() {
  getData(); // This should trigger an error
}
