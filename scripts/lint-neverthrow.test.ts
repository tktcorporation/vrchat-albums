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

  describe('must-use-result', () => {
    it('should detect unhandled Result from function call', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        mustUseResult: {
          enabled: true,
          path: path.join(fixturesDir, 'must-use-result-invalid.ts'),
        },
      };

      const result = await lintNeverthrow(testConfig);

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.ruleName === 'must-use-result')).toBe(
        true,
      );
    });

    it('should pass when Result is handled with match()', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        mustUseResult: {
          enabled: true,
          path: path.join(fixturesDir, 'must-use-result-valid.ts'),
        },
      };

      const result = await lintNeverthrow(testConfig);

      const mustUseIssues = result.issues.filter(
        (i) => i.ruleName === 'must-use-result',
      );
      expect(mustUseIssues).toHaveLength(0);
    });

    it('should pass when Result is returned', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        mustUseResult: {
          enabled: true,
          path: path.join(fixturesDir, 'must-use-result-return.ts'),
        },
      };

      const result = await lintNeverthrow(testConfig);

      const mustUseIssues = result.issues.filter(
        (i) => i.ruleName === 'must-use-result',
      );
      expect(mustUseIssues).toHaveLength(0);
    });

    it('should detect unhandled Result assigned to variable', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        mustUseResult: {
          enabled: true,
          path: path.join(fixturesDir, 'must-use-result-unhandled-var.ts'),
        },
      };

      const result = await lintNeverthrow(testConfig);

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.ruleName === 'must-use-result')).toBe(
        true,
      );
    });
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

  describe('try-catch warning: prefer-fromThrowable', () => {
    it('should warn when using plain try-catch without proper patterns', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        tryCatchWarning: {
          enabled: true,
          path: path.join(fixturesDir, 'try-catch-warning.ts'),
          exceptions: {
            allowWithFinally: true,
            allowInsideFromPromise: true,
            allowWithRethrow: true,
          },
        },
      };

      const result = await lintNeverthrow(testConfig);

      // Should have warnings (not errors)
      const tryCatchWarnings = result.issues.filter(
        (i) => i.ruleName === 'prefer-fromThrowable',
      );
      expect(tryCatchWarnings.length).toBeGreaterThan(0);
      expect(tryCatchWarnings[0].severity).toBe('warning');
      expect(tryCatchWarnings[0].message).toContain('fromThrowable');
    });

    it('should not warn when try-catch has finally block for cleanup', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        tryCatchWarning: {
          enabled: true,
          path: path.join(fixturesDir, 'try-catch-with-finally.ts'),
          exceptions: {
            allowWithFinally: true,
            allowInsideFromPromise: true,
            allowWithRethrow: true,
          },
        },
      };

      const result = await lintNeverthrow(testConfig);

      const tryCatchWarnings = result.issues.filter(
        (i) => i.ruleName === 'prefer-fromThrowable',
      );
      expect(tryCatchWarnings).toHaveLength(0);
    });

    it('should not warn when try-catch has proper error classification with rethrow', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        tryCatchWarning: {
          enabled: true,
          path: path.join(fixturesDir, 'try-catch-proper-rethrow.ts'),
          exceptions: {
            allowWithFinally: true,
            allowInsideFromPromise: true,
            allowWithRethrow: true,
          },
        },
      };

      const result = await lintNeverthrow(testConfig);

      const tryCatchWarnings = result.issues.filter(
        (i) => i.ruleName === 'prefer-fromThrowable',
      );
      expect(tryCatchWarnings).toHaveLength(0);
    });

    it('should warn when allowWithRethrow is disabled even with proper rethrow', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        tryCatchWarning: {
          enabled: true,
          path: path.join(fixturesDir, 'try-catch-proper-rethrow.ts'),
          exceptions: {
            allowWithFinally: true,
            allowInsideFromPromise: true,
            allowWithRethrow: false, // Disabled
          },
        },
      };

      const result = await lintNeverthrow(testConfig);

      const tryCatchWarnings = result.issues.filter(
        (i) => i.ruleName === 'prefer-fromThrowable',
      );
      expect(tryCatchWarnings.length).toBeGreaterThan(0);
    });
  });

  describe('genericErrorWarning', () => {
    it('should warn when using err(new Error(...))', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        genericErrorWarning: {
          enabled: true,
          path: path.join(fixturesDir, 'generic-error-warning.ts'),
        },
      };

      const result = await lintNeverthrow(testConfig);

      const genericErrorWarnings = result.issues.filter(
        (i) => i.ruleName === 'no-generic-error',
      );
      expect(genericErrorWarnings).toHaveLength(1);
      expect(genericErrorWarnings[0].message).toContain(
        'Avoid using err(new Error(...))',
      );
    });

    it('should warn when using err({ type: "UNEXPECTED", ... })', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [],
        genericErrorWarning: {
          enabled: true,
          path: path.join(fixturesDir, 'generic-error-warning.ts'),
        },
      };

      const result = await lintNeverthrow(testConfig);

      const unexpectedWarnings = result.issues.filter(
        (i) => i.ruleName === 'no-unexpected-error-type',
      );
      expect(unexpectedWarnings).toHaveLength(1);
      expect(unexpectedWarnings[0].message).toContain('UNEXPECTED');
    });
  });
});
