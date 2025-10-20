import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintValueObjects } from './lint-valueobjects.js';

describe('ValueObject Linter', () => {
  const fixturesDir = path.join(
    process.cwd(),
    'scripts/test-fixtures/valueobjects',
  );

  it('should pass for valid ValueObject', async () => {
    // Run linter on specific fixture file
    const result = await lintValueObjects(false, [
      path.join(fixturesDir, 'valid.ts'),
    ]);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.message).toContain(
      'All ValueObject implementations follow the correct pattern!',
    );
  });

  it('should detect indirect inheritance from BaseValueObject', async () => {
    // Run linter on both PathObject and SpecialPathObject
    const result = await lintValueObjects(false, [
      path.join(fixturesDir, 'pathObject.ts'),
      path.join(fixturesDir, 'specialPathObject.ts'),
    ]);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.message).toContain(
      'All ValueObject implementations follow the correct pattern!',
    );
  });

  it('should fail when indirect ValueObject is exported as class', async () => {
    // Run linter on invalidPathObject
    const result = await lintValueObjects(false, [
      path.join(fixturesDir, 'pathObject.ts'),
      path.join(fixturesDir, 'invalidPathObject.ts'),
    ]);

    expect(result.success).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should fail for ValueObject exported as class', async () => {
    // Run linter on invalid-export
    const result = await lintValueObjects(false, [
      path.join(fixturesDir, 'invalid-export.ts'),
    ]);

    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('should fail for ValueObject with export class syntax', async () => {
    // Run linter on invalid-export-class
    const result = await lintValueObjects(false, [
      path.join(fixturesDir, 'invalid-export-class.ts'),
    ]);

    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });
});
