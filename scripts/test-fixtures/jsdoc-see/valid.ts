/**
 * Valid JSDoc @see references
 *
 * @see docs/error-handling.md - Valid reference to existing doc
 * @see https://example.com/docs - URL references are skipped
 * @see MyClass - Symbol references are skipped
 * @see useHybridPhotoLoading - Symbol references are skipped
 */
export function validFunction() {
  return 'valid';
}

/**
 * Another valid function with JSDoc link syntax
 * @see {@link MyClass} - JSDoc link syntax is skipped
 */
export function anotherValidFunction() {
  return 'also valid';
}
