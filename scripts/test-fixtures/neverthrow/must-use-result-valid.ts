import { ok, type Result } from 'neverthrow';

type DataError = { type: 'NOT_FOUND' };

function getData(): Result<string, DataError> {
  return ok('data');
}

// Valid: Result is consumed with match()
function _main() {
  getData().match(
    (data) => console.log(data),
    (error) => console.error(error),
  );
}

// Valid: Result is consumed with unwrapOr()
function _main2() {
  const data = getData().unwrapOr('default');
  console.log(data);
}

// Valid: Result is consumed with _unsafeUnwrap()
function _main3() {
  const data = getData()._unsafeUnwrap();
  console.log(data);
}
