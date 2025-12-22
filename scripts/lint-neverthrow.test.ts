import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  lintNeverthrow,
  type NeverthrowLintConfig,
} from './lint-neverthrow.js';

describe('Neverthrow Linter', () => {
  const fixturesDir = path.join(
    process.cwd(),
    'scripts/test-fixtures/neverthrow',
  );

  it('should pass for function with Result return type', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test rule',
          path: path.join(fixturesDir, 'valid-service.ts'),
          enforceResult: true,
          apply: 'async-functions',
          exceptions: [],
        },
      ],
    };

    // Run linter with specific fixture file
    const result = await lintNeverthrow(testConfig);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.message).toContain(
      'All functions follow neverthrow error handling pattern!',
    );
  });

  it('should fail for async function without Result return type', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test rule',
          path: path.join(fixturesDir, 'invalid-service.ts'),
          enforceResult: true,
          apply: 'async-functions',
          exceptions: [],
        },
      ],
    };

    // Run linter and expect failure
    const result = await lintNeverthrow(testConfig);

    expect(result.success).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should respect exceptions list', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test rule with exceptions',
          path: path.join(fixturesDir, 'service-with-exception.ts'),
          enforceResult: true,
          apply: 'async-functions',
          exceptions: ['getAppVersion'],
        },
      ],
    };

    // Run linter - should pass because getAppVersion is in exceptions
    const result = await lintNeverthrow(testConfig);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should check only exported functions when apply is "exported-functions"', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test exported functions',
          path: path.join(fixturesDir, 'mixed-functions.ts'),
          enforceResult: true,
          apply: 'exported-functions',
          exceptions: [],
        },
      ],
    };

    // Run linter - should pass because private function is not checked
    const result = await lintNeverthrow(testConfig);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  describe('Anti-pattern detection: catch-err without classification', () => {
    it('should detect catch block wrapping errors without classification', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test anti-pattern',
            path: path.join(fixturesDir, 'anti-pattern.ts'),
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      // Run linter and expect failure
      const result = await lintNeverthrow(testConfig);
      expect(result.success).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should pass when errors are properly classified with match()', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test proper classification',
            path: path.join(fixturesDir, 'proper-classification.ts'),
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      // Run linter - should pass
      const result = await lintNeverthrow(testConfig);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.message).toContain(
        'All functions follow neverthrow error handling pattern!',
      );
    });
  });
});
