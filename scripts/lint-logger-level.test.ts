import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LoggerLevelLinter } from './lint-logger-level.js';

describe('Logger Level Linter', () => {
  const fixturesDir = path.join(
    process.cwd(),
    'scripts/test-fixtures/logger-level',
  );

  it('should pass for logger.error() with unexpected_error reason', () => {
    const validFile = path.join(fixturesDir, 'valid-error-log.ts');
    const linter = new LoggerLevelLinter([validFile]);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should fail for logger.warn() with unexpected_error reason', () => {
    const invalidFile = path.join(fixturesDir, 'invalid-warn-log.ts');
    const linter = new LoggerLevelLinter([invalidFile]);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toContain('logger.error()');
    expect(result.issues[0].message).toContain('Sentry');
  });

  it('should pass for logger.warn() with expected error reason', () => {
    const validFile = path.join(fixturesDir, 'valid-warn-expected.ts');
    const linter = new LoggerLevelLinter([validFile]);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect logger.warn() with unexpected_error in virtual file', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/warn-unexpected.ts';
    sourceMap.set(
      testFile,
      `
const logger = { warn: (x: unknown) => x, error: (x: unknown) => x };

async function test() {
  try {
    throw new Error('test');
  } catch (error) {
    logger.warn({ message: 'failed' });
    return {
      error: {
        reason: 'unexpected_error' as const,
        message: 'failed',
      },
    };
  }
}
`,
    );

    const linter = new LoggerLevelLinter([testFile], sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it('should not flag warn() calls outside catch blocks', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/warn-outside-catch.ts';
    sourceMap.set(
      testFile,
      `
const logger = { warn: (x: unknown) => x };

function test() {
  logger.warn({ message: 'not in catch' });
  return {
    error: {
      reason: 'unexpected_error' as const,
    },
  };
}
`,
    );

    const linter = new LoggerLevelLinter([testFile], sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should report correct line numbers', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/line-numbers.ts';
    sourceMap.set(
      testFile,
      `const logger = { warn: (x: unknown) => x };
// Line 2
async function test() {
  try {
    throw new Error('test');
  } catch (error) {
    logger.warn({ message: 'failed' }); // Line 7
    return {
      error: { reason: 'unexpected_error' as const },
    };
  }
}
`,
    );

    const linter = new LoggerLevelLinter([testFile], sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].warnLine).toBe(7);
  });
});
