// This file should trigger the generic error warning
import { err, ok, type Result } from 'neverthrow';

// BAD: Using err(new Error(...)) - should trigger warning
export function badPattern(): Result<string, Error> {
  const shouldFail = true;
  if (shouldFail) {
    return err(new Error('This is a generic error'));
  }
  return ok('success');
}

// GOOD: Using specific error type - should NOT trigger warning
type SpecificError = { type: 'VALIDATION_ERROR'; message: string };

export function goodPattern(): Result<string, SpecificError> {
  const shouldFail = true;
  if (shouldFail) {
    return err({ type: 'VALIDATION_ERROR', message: 'Validation failed' });
  }
  return ok('success');
}

// BAD: Using err({ type: 'UNEXPECTED', ... }) - should trigger warning
export function unexpectedPattern(): Result<
  string,
  { type: 'UNEXPECTED'; message: string }
> {
  const shouldFail = true;
  if (shouldFail) {
    return err({
      type: 'UNEXPECTED',
      message: 'This should be thrown instead',
    });
  }
  return ok('success');
}
