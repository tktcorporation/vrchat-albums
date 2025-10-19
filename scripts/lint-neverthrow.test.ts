import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Neverthrow Linter', () => {
  const testDir = path.join(process.cwd(), 'test-neverthrow');
  const configPath = path.join(testDir, '.neverthrowlintrc.json');

  beforeAll(() => {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should pass for function with Result return type', () => {
    const testConfig = {
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

export async function loadData(): Promise<Result<string, Error>> {
  return ok('data');
}
`;

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
    fs.writeFileSync(path.join(testDir, 'valid-service.ts'), validService);

    // Run linter
    const result = execSync(
      `npx tsx scripts/lint-neverthrow.ts --config ${configPath}`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    expect(result).toContain(
      'All functions follow neverthrow error handling pattern!',
    );
  });

  it('should fail for async function without Result return type', () => {
    const testConfig = {
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

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
    fs.writeFileSync(path.join(testDir, 'invalid-service.ts'), invalidService);

    // Run linter and expect failure
    expect(() => {
      execSync(`npx tsx scripts/lint-neverthrow.ts --config ${configPath}`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
    }).toThrow();
  });

  it('should respect exceptions list', () => {
    const testConfig = {
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
export async function getAppVersion(): Promise<string> {
  return '1.0.0';
}

export async function loadData(): Promise<neverthrow.Result<string, Error>> {
  return neverthrow.ok('data');
}
`;

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
    fs.writeFileSync(
      path.join(testDir, 'service-with-exception.ts'),
      serviceWithException,
    );

    // Run linter - should pass because getAppVersion is in exceptions
    const result = execSync(
      `npx tsx scripts/lint-neverthrow.ts --config ${configPath}`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    expect(result).toContain(
      'All functions follow neverthrow error handling pattern!',
    );
  });

  it('should check only exported functions when apply is "exported-functions"', () => {
    const testConfig = {
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

// Private function without Result - should be ignored
async function privateFunction(): Promise<string> {
  return 'private';
}

// Exported function with Result - should pass
export async function publicFunction(): Promise<Result<string, Error>> {
  return ok('public');
}
`;

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
    fs.writeFileSync(
      path.join(testDir, 'service-private.ts'),
      serviceWithPrivateFunction,
    );

    // Run linter - should pass
    const result = execSync(
      `npx tsx scripts/lint-neverthrow.ts --config ${configPath}`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    expect(result).toContain(
      'All functions follow neverthrow error handling pattern!',
    );
  });

  it('should detect ResultAsync return type', () => {
    const testConfig = {
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

export async function loadDataAsync(): Promise<ResultAsync<string, Error>> {
  return okAsync('data');
}
`;

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
    fs.writeFileSync(
      path.join(testDir, 'service-result-async.ts'),
      serviceWithResultAsync,
    );

    // Run linter
    const result = execSync(
      `npx tsx scripts/lint-neverthrow.ts --config ${configPath}`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    expect(result).toContain(
      'All functions follow neverthrow error handling pattern!',
    );
  });

  it('should check arrow functions assigned to exported const', () => {
    const testConfig = {
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

export const loadData = async (): Promise<Result<string, Error>> => {
  return ok('data');
};
`;

    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
    fs.writeFileSync(
      path.join(testDir, 'service-arrow.ts'),
      serviceWithArrowFunction,
    );

    // Run linter
    const result = execSync(
      `npx tsx scripts/lint-neverthrow.ts --config ${configPath}`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    expect(result).toContain(
      'All functions follow neverthrow error handling pattern!',
    );
  });
});
