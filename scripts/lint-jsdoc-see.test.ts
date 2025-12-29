import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsDocSeeLinter } from './lint-jsdoc-see.js';

describe('JSDoc @see Linter', () => {
  const fixturesDir = path.join(
    process.cwd(),
    'scripts/test-fixtures/jsdoc-see',
  );
  const projectRoot = process.cwd();

  it('should pass for valid @see references', () => {
    const validFile = path.join(fixturesDir, 'valid.ts');
    const linter = new JsDocSeeLinter([validFile], projectRoot);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect invalid @see reference to non-existent doc', () => {
    const invalidFile = path.join(fixturesDir, 'invalid-doc-ref.ts');
    const linter = new JsDocSeeLinter([invalidFile], projectRoot);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].missingPath).toBe('docs/non-existent-file.md');
    expect(result.issues[0].severity).toBe('error');
  });

  it('should detect multiple invalid @see references', () => {
    const multipleFile = path.join(fixturesDir, 'multiple-refs.ts');
    const linter = new JsDocSeeLinter([multipleFile], projectRoot);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(2);

    const missingPaths = result.issues.map((i) => i.missingPath);
    expect(missingPaths).toContain('docs/missing-doc.md');
    expect(missingPaths).toContain('src/non-existent.ts');
  });

  it('should skip URL references', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/url-refs.ts';
    sourceMap.set(
      testFile,
      `
/**
 * @see https://example.com/docs
 * @see http://localhost:3000/api
 */
export function test() {}
`,
    );

    const linter = new JsDocSeeLinter([testFile], '/test', sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should skip symbol references without path separators', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/symbol-refs.ts';
    sourceMap.set(
      testFile,
      `
/**
 * @see MyClass
 * @see useHybridPhotoLoading
 * @see CONSTANT_VALUE
 */
export function test() {}
`,
    );

    const linter = new JsDocSeeLinter([testFile], '/test', sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should skip JSDoc link syntax', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/link-syntax.ts';
    sourceMap.set(
      testFile,
      `
/**
 * @see {@link MyClass}
 * @see {@link module:utils}
 */
export function test() {}
`,
    );

    const linter = new JsDocSeeLinter([testFile], '/test', sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should report correct line and column numbers', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/line-numbers.ts';
    sourceMap.set(
      testFile,
      `// Line 1
// Line 2
/**
 * Line 4
 * @see docs/missing.md
 */
export function test() {}
`,
    );

    const linter = new JsDocSeeLinter([testFile], '/test', sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].line).toBe(5);
    expect(result.issues[0].column).toBeGreaterThan(0);
  });
});
