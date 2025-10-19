import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// タイムアウトを15秒に設定（npx tsxの実行が遅いため）
const TEST_TIMEOUT = 15000;

describe('ValueObject Linter', () => {
  const testDir = path.join(process.cwd(), 'test-valueobjects');

  beforeAll(() => {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should pass for valid ValueObject', { timeout: TEST_TIMEOUT }, () => {
    const validValueObject = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';
import { z } from 'zod';

class TestId extends BaseValueObject<'TestId', string> {}

export type { TestId };
export const TestIdSchema = z.string().transform(val => new TestId(val));
`;

    fs.writeFileSync(path.join(testDir, 'valid.ts'), validValueObject);

    // Run linter on test file
    const result = execSync('npx tsx scripts/lint-valueobjects.ts', {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result).toContain(
      'All ValueObject implementations follow the correct pattern!',
    );
  });

  it(
    'should detect indirect inheritance from BaseValueObject',
    { timeout: TEST_TIMEOUT },
    () => {
      // Create a base PathObject
      const pathObject = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';
import { z } from 'zod';

class PathObject extends BaseValueObject<'PathObject', string> {}

export type { PathObject };
export const PathObjectSchema = z.string().transform(val => new PathObject(val));
`;

      // Create a class that extends PathObject (indirect inheritance)
      const specialPathObject = `
import { PathObject, PathObjectSchema } from './pathObject.js';
import { z } from 'zod';

const opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

class SpecialPathObject extends PathObject {
  // @ts-ignore
  private readonly [opaqueSymbol]: 'SpecialPathObject';
}

export type { SpecialPathObject };
export const SpecialPathObjectSchema = z.string().transform(val => new SpecialPathObject(val));
`;

      fs.writeFileSync(path.join(testDir, 'pathObject.ts'), pathObject);
      fs.writeFileSync(
        path.join(testDir, 'specialPathObject.ts'),
        specialPathObject,
      );

      // Run linter on test files
      const result = execSync('npx tsx scripts/lint-valueobjects.ts', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });

      expect(result).toContain(
        'All ValueObject implementations follow the correct pattern!',
      );
    },
  );

  it(
    'should fail when indirect ValueObject is exported as class',
    { timeout: TEST_TIMEOUT },
    () => {
      // Create a base PathObject
      const pathObject = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';
import { z } from 'zod';

class PathObject extends BaseValueObject<'PathObject', string> {}

export type { PathObject };
export const PathObjectSchema = z.string().transform(val => new PathObject(val));
`;

      // Create a class that extends PathObject but exports it incorrectly
      const invalidPathObject = `
import { PathObject, PathObjectSchema } from './pathObject.js';
import { z } from 'zod';

const opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

export class InvalidPathObject extends PathObject {
  // @ts-ignore
  private readonly [opaqueSymbol]: 'InvalidPathObject';
}

export const InvalidPathObjectSchema = z.string().transform(val => new InvalidPathObject(val));
`;

      fs.writeFileSync(path.join(testDir, 'pathObject.ts'), pathObject);
      fs.writeFileSync(
        path.join(testDir, 'invalidPathObject.ts'),
        invalidPathObject,
      );

      // Run linter on test files
      expect(() => {
        execSync('npx tsx scripts/lint-valueobjects.ts', {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
      }).toThrow();
    },
  );

  it(
    'should fail for ValueObject with mismatched brand type',
    { timeout: TEST_TIMEOUT },
    () => {
      const invalidValueObject = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';

class TestId extends BaseValueObject<'WrongBrand', string> {}
`;

      fs.writeFileSync(path.join(testDir, 'invalid.ts'), invalidValueObject);

      // Run linter on test file and expect it to fail
      expect(() => {
        execSync('npx tsx scripts/lint-valueobjects.ts', {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
      }).toThrow();
    },
  );

  it(
    'should fail for ValueObject exported as class',
    { timeout: TEST_TIMEOUT },
    () => {
      const invalidExport = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';
import { z } from 'zod';

class TestId extends BaseValueObject<'TestId', string> {}

export { TestId };
export const TestIdSchema = z.string().transform(val => new TestId(val));
`;

      fs.writeFileSync(path.join(testDir, 'invalid-export.ts'), invalidExport);

      // Run linter on test file and expect it to fail
      expect(() => {
        execSync('npx tsx scripts/lint-valueobjects.ts', {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
      }).toThrow();
    },
  );

  it(
    'should fail for ValueObject with export class syntax',
    { timeout: TEST_TIMEOUT },
    () => {
      const invalidExportClass = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';
import { z } from 'zod';

export class TestId extends BaseValueObject<'TestId', string> {}

export const TestIdSchema = z.string().transform(val => new TestId(val));
`;

      fs.writeFileSync(
        path.join(testDir, 'invalid-export-class.ts'),
        invalidExportClass,
      );

      // Run linter on test file and expect it to fail
      expect(() => {
        execSync('npx tsx scripts/lint-valueobjects.ts', {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
      }).toThrow();
    },
  );
});
