/**
 * Multiple @see references - some valid, some invalid
 *
 * @see docs/error-handling.md - Valid
 * @see docs/missing-doc.md - Invalid
 * @see electron/lib/errors.ts - Valid
 * @see src/non-existent.ts - Invalid
 */
export function multipleRefs() {
  return 'multiple';
}
