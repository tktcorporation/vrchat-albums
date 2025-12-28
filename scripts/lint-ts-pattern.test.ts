import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TsPatternLinter } from './lint-ts-pattern.js';

describe('ts-pattern Linter', () => {
  const fixturesDir = path.join(
    process.cwd(),
    'scripts/test-fixtures/ts-pattern',
  );

  it('should pass for match() with .exhaustive()', () => {
    const validFile = path.join(fixturesDir, 'valid-exhaustive.ts');
    const linter = new TsPatternLinter([validFile]);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should warn for match() with .otherwise() but no .exhaustive()', () => {
    const invalidFile = path.join(fixturesDir, 'missing-exhaustive.ts');
    const linter = new TsPatternLinter([invalidFile]);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].severity).toBe('warning');
    expect(result.issues[0].message).toContain('.exhaustive()');
  });

  it('should detect .otherwise() in method chain', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/otherwise-chain.ts';
    sourceMap.set(
      testFile,
      `
import { match } from 'ts-pattern';

const result = match(value)
  .with({ type: 'a' }, () => 'a')
  .with({ type: 'b' }, () => 'b')
  .otherwise(() => 'default');
`,
    );

    const linter = new TsPatternLinter([testFile], sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('without .exhaustive()');
  });

  it('should not flag non-match chains with .otherwise()', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/non-match-otherwise.ts';
    sourceMap.set(
      testFile,
      `
// This is not a ts-pattern match chain
const obj = {
  otherwise: () => 'not ts-pattern',
};

obj.otherwise();
`,
    );

    const linter = new TsPatternLinter([testFile], sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should pass when .exhaustive() is used even with complex chains', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/complex-exhaustive.ts';
    sourceMap.set(
      testFile,
      `
import { match, P } from 'ts-pattern';

type MyType = { kind: 'a' } | { kind: 'b' } | { kind: 'c' };

const result = match<MyType>(value)
  .with({ kind: 'a' }, () => 1)
  .with({ kind: 'b' }, () => 2)
  .with({ kind: 'c' }, () => 3)
  .exhaustive();
`,
    );

    const linter = new TsPatternLinter([testFile], sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should report correct line numbers', () => {
    const sourceMap = new Map<string, string>();
    const testFile = '/test/line-numbers.ts';
    sourceMap.set(
      testFile,
      `import { match } from 'ts-pattern';
// Line 2
// Line 3
const result = match(value)
  .with({ a: 1 }, () => 'a')
  .otherwise(() => 'default'); // Line 6
`,
    );

    const linter = new TsPatternLinter([testFile], sourceMap);
    const result = linter.lint();

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].line).toBe(6);
  });
});
