import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lintValueObjects } from './lint-valueobjects.js';

describe('ValueObject Linter', { concurrent: false }, () => {
  const testDir = path.join(process.cwd(), 'test-valueobjects');

  beforeAll(() => {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });
  });

  beforeEach(() => {
    // Clean up test directory contents before each test
    const files = fs.readdirSync(testDir);
    for (const file of files) {
      fs.unlinkSync(path.join(testDir, file));
    }
  });

  afterAll(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should pass for valid ValueObject', async () => {
    const validValueObject = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';
import { z } from 'zod';

class TestId extends BaseValueObject<'TestId', string> {}

export type { TestId };
export const TestIdSchema = z.string().transform(val => new TestId(val));
`;

    fs.writeFileSync(path.join(testDir, 'valid.ts'), validValueObject);

    // Run linter using the imported function
    const result = await lintValueObjects(true);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.message).toContain(
      'All ValueObject implementations follow the correct pattern!',
    );
  });

  it('should detect indirect inheritance from BaseValueObject', async () => {
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

    // Run linter using the imported function
    const result = await lintValueObjects(true);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.message).toContain(
      'All ValueObject implementations follow the correct pattern!',
    );
  });

  it('should fail when indirect ValueObject is exported as class', async () => {
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

    // Run linter using the imported function
    const result = await lintValueObjects(true);

    expect(result.success).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should fail for ValueObject with mismatched brand type', async () => {
    const invalidValueObject = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';

class TestId extends BaseValueObject<'WrongBrand', string> {}
`;

    fs.writeFileSync(path.join(testDir, 'invalid.ts'), invalidValueObject);

    // Run linter using the imported function
    const result = await lintValueObjects(true);

    expect(result.success).toBe(true); // Warning only, not error
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('should fail for ValueObject exported as class', async () => {
    const invalidExport = `
import { BaseValueObject } from '../electron/lib/baseValueObject.js';
import { z } from 'zod';

class TestId extends BaseValueObject<'TestId', string> {}

export { TestId };
export const TestIdSchema = z.string().transform(val => new TestId(val));
`;

    fs.writeFileSync(path.join(testDir, 'invalid-export.ts'), invalidExport);

    // Run linter using the imported function
    const result = await lintValueObjects(true);

    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('should fail for ValueObject with export class syntax', async () => {
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

    // Run linter using the imported function
    const result = await lintValueObjects(true);

    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });
});
