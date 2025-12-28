import { ok, type Result } from 'neverthrow';

type DataError = { type: 'NOT_FOUND' };

function getData(): Result<string, DataError> {
  return ok('data');
}

// Valid: Result is returned
function _wrapper(): Result<string, DataError> {
  return getData();
}

// Valid: Result is returned via arrow function
const _wrapper2 = (): Result<string, DataError> => getData();
