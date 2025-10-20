import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type NeverthrowLintConfig,
  lintNeverthrow,
} from './lint-neverthrow.js';

describe('Neverthrow Linter', () => {
  const testDir = path.join(process.cwd(), 'test-neverthrow');

  beforeAll(() => {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });
  });

  beforeEach(() => {
    // Clean up test files before each test
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.rmSync(path.join(testDir, file), { force: true });
      }
    }
  });

  afterAll(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should pass for function with Result return type', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test rule',
          path: 'test-neverthrow/**/*.ts',
          enforceResult: true,
          apply: 'async-functions',
          exceptions: [],
        },
      ],
    };

    const validService = `
import { Result, ok, err } from 'neverthrow';

type DataError = { type: 'NOT_FOUND' } | { type: 'TIMEOUT' };

export async function loadData(): Promise<Result<string, DataError>> {
  return ok('data');
}
`;

    fs.writeFileSync(path.join(testDir, 'valid-service.ts'), validService);

    // Run linter with the imported function
    const result = await lintNeverthrow(testConfig, true);

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
          path: 'test-neverthrow/**/*.ts',
          enforceResult: true,
          apply: 'async-functions',
          exceptions: [],
        },
      ],
    };

    const invalidService = `
export async function loadData(): Promise<string> {
  return 'data';
}
`;

    fs.writeFileSync(path.join(testDir, 'invalid-service.ts'), invalidService);

    // Run linter and expect failure
    const result = await lintNeverthrow(testConfig, true);

    expect(result.success).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should respect exceptions list', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test rule with exceptions',
          path: 'test-neverthrow/**/*.ts',
          enforceResult: true,
          apply: 'async-functions',
          exceptions: ['getAppVersion'],
        },
      ],
    };

    const serviceWithException = `
import * as neverthrow from 'neverthrow';

type DataError = { type: 'NOT_FOUND' };

export async function getAppVersion(): Promise<string> {
  return '1.0.0';
}

export async function loadData(): Promise<neverthrow.Result<string, DataError>> {
  return neverthrow.ok('data');
}
`;

    fs.writeFileSync(
      path.join(testDir, 'service-with-exception.ts'),
      serviceWithException,
    );

    // Run linter - should pass because getAppVersion is in exceptions
    const result = await lintNeverthrow(testConfig, true);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should check only exported functions when apply is "exported-functions"', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test exported functions',
          path: 'test-neverthrow/**/*.ts',
          enforceResult: true,
          apply: 'exported-functions',
          exceptions: [],
        },
      ],
    };

    const serviceWithPrivateFunction = `
import { Result, ok } from 'neverthrow';

type DataError = { type: 'ERROR' };

// Private function without Result - should be ignored
async function privateFunction(): Promise<string> {
  return 'private';
}

// Exported function with Result - should pass
export async function publicFunction(): Promise<Result<string, DataError>> {
  return ok('public');
}
`;

    fs.writeFileSync(
      path.join(testDir, 'service-private.ts'),
      serviceWithPrivateFunction,
    );

    // Run linter - should pass
    const result = await lintNeverthrow(testConfig, true);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect ResultAsync return type', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test ResultAsync',
          path: 'test-neverthrow/**/*.ts',
          enforceResult: true,
          apply: 'async-functions',
          exceptions: [],
        },
      ],
    };

    const serviceWithResultAsync = `
import { ResultAsync, okAsync } from 'neverthrow';

type DataError = { type: 'ERROR' };

export async function loadDataAsync(): Promise<ResultAsync<string, DataError>> {
  return okAsync('data');
}
`;

    fs.writeFileSync(
      path.join(testDir, 'service-result-async.ts'),
      serviceWithResultAsync,
    );

    // Run linter
    const result = await lintNeverthrow(testConfig, true);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should check arrow functions assigned to exported const', async () => {
    const testConfig: NeverthrowLintConfig = {
      rules: [
        {
          name: 'Test arrow functions',
          path: 'test-neverthrow/**/*.ts',
          enforceResult: true,
          apply: 'async-functions',
          exceptions: [],
        },
      ],
    };

    const serviceWithArrowFunction = `
import { Result, ok } from 'neverthrow';

type DataError = { type: 'ERROR' };

export const loadData = async (): Promise<Result<string, DataError>> => {
  return ok('data');
};
`;

    fs.writeFileSync(
      path.join(testDir, 'service-arrow.ts'),
      serviceWithArrowFunction,
    );

    // Run linter
    const result = await lintNeverthrow(testConfig, true);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  describe('Anti-pattern detection: catch-err without classification', () => {
    it('should detect catch block wrapping errors without classification', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test anti-pattern',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithAntiPattern = `
import { Result, ok, err } from 'neverthrow';

type DataError = { type: 'ERROR' };

export async function loadData(): Promise<Result<string, DataError>> {
  try {
    return ok('data');
  } catch (error) {
    // Anti-pattern: just wrapping error without classification
    return err({ type: 'ERROR' });
  }
}
`;

      fs.writeFileSync(
        path.join(testDir, 'anti-pattern.ts'),
        serviceWithAntiPattern,
      );

      // Run linter and expect failure
      const result = await lintNeverthrow(testConfig, true);
      expect(result.success).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should pass when errors are properly classified with match()', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test proper classification',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithProperClassification = `
import { Result, ok, err } from 'neverthrow';
import { match } from 'ts-pattern';

type DataError =
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'TIMEOUT'; message: string };

export async function loadData(): Promise<Result<string, DataError>> {
  try {
    return ok('data');
  } catch (error) {
    // Proper classification by error code
    return match(error)
      .with({ code: 'ENOENT' }, (e) =>
        err({ type: 'FILE_NOT_FOUND', path: e.path })
      )
      .with({ code: 'ETIMEDOUT' }, (e) =>
        err({ type: 'TIMEOUT', message: e.message })
      )
      .otherwise((e) => {
        throw e; // Re-throw unexpected errors
      });
  }
}
`;

      fs.writeFileSync(
        path.join(testDir, 'proper-classification.ts'),
        serviceWithProperClassification,
      );

      // Run linter - should pass
      const result = await lintNeverthrow(testConfig, true);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.message).toContain(
        'All functions follow neverthrow error handling pattern!',
      );
    });

    it('should pass when unexpected errors are re-thrown', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test re-throw',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithReThrow = `
import { Result, ok } from 'neverthrow';

export async function loadData(): Promise<Result<string, never>> {
  try {
    return ok('data');
  } catch (error) {
    // All errors are unexpected - re-throw
    throw error;
  }
}
`;

      fs.writeFileSync(path.join(testDir, 're-throw.ts'), serviceWithReThrow);

      // Run linter - should pass
      const result = await lintNeverthrow(testConfig, true);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.message).toContain(
        'All functions follow neverthrow error handling pattern!',
      );
    });

    it('should pass when using if statements for error classification', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test if classification',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithIfClassification = `
import { Result, ok, err } from 'neverthrow';

type FileError = { type: 'NOT_FOUND' } | { type: 'ACCESS_DENIED' };

export async function readFile(): Promise<Result<string, FileError>> {
  try {
    return ok('content');
  } catch (error: any) {
    // Classification using if statements
    if (error.code === 'ENOENT') {
      return err({ type: 'NOT_FOUND' });
    }
    if (error.code === 'EACCES') {
      return err({ type: 'ACCESS_DENIED' });
    }
    throw error; // Re-throw unexpected errors
  }
}
`;

      fs.writeFileSync(
        path.join(testDir, 'if-classification.ts'),
        serviceWithIfClassification,
      );

      // Run linter - should pass
      const result = await lintNeverthrow(testConfig, true);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.message).toContain(
        'All functions follow neverthrow error handling pattern!',
      );
    });

    it('should detect anti-pattern even with match() that only checks instanceof', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test instanceof-only match',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithInstanceOfOnly = `
import { Result, ok, err } from 'neverthrow';
import { match, P } from 'ts-pattern';

type DataError = { type: 'ERROR'; message: string };

export async function loadData(): Promise<Result<string, DataError>> {
  try {
    return ok('data');
  } catch (error) {
    // Anti-pattern: match() but only checking instanceof, not error code/type
    return err(
      match(error)
        .with(P.instanceOf(Error), (e) => ({ type: 'ERROR' as const, message: e.message }))
        .otherwise(() => ({ type: 'ERROR' as const, message: 'Unknown error' }))
    );
  }
}
`;

      fs.writeFileSync(
        path.join(testDir, 'instanceof-only.ts'),
        serviceWithInstanceOfOnly,
      );

      // Run linter and expect failure
      const result = await lintNeverthrow(testConfig, true);
      expect(result.success).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Generic error type detection', () => {
    it('should warn when using Result<T, Error>', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test generic error',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithGenericError = `
import { Result, ok } from 'neverthrow';

export async function loadData(): Promise<Result<string, Error>> {
  return ok('data');
}
`;

      fs.writeFileSync(
        path.join(testDir, 'generic-error.ts'),
        serviceWithGenericError,
      );

      // Run linter - should have warnings
      const result = await lintNeverthrow(testConfig, true);

      expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
      expect(
        result.issues.some((i) => i.message.includes('generic error type')),
      ).toBe(true);
    });

    it('should warn when using Result<T, any>', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test any error',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithAnyError = `
import { Result, ok } from 'neverthrow';

export async function loadData(): Promise<Result<string, any>> {
  return ok('data');
}
`;

      fs.writeFileSync(path.join(testDir, 'any-error.ts'), serviceWithAnyError);

      // Run linter - should have warnings
      const result = await lintNeverthrow(testConfig, true);

      expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
      expect(
        result.issues.some((i) => i.message.includes('generic error type')),
      ).toBe(true);
    });

    it('should pass when using specific error union types', async () => {
      const testConfig: NeverthrowLintConfig = {
        rules: [
          {
            name: 'Test specific error',
            path: 'test-neverthrow/**/*.ts',
            enforceResult: true,
            apply: 'async-functions',
            exceptions: [],
          },
        ],
      };

      const serviceWithSpecificError = `
import { Result, ok } from 'neverthrow';

type DataError =
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'TIMEOUT'; message: string };

export async function loadData(): Promise<Result<string, DataError>> {
  return ok('data');
}
`;

      fs.writeFileSync(
        path.join(testDir, 'specific-error.ts'),
        serviceWithSpecificError,
      );

      // Run linter - should pass without warnings
      const result = await lintNeverthrow(testConfig, true);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });
});
