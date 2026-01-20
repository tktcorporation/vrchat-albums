import { describe, expect, it } from 'vitest';
import { FloatingPromiseLinter } from './lint-floating-promises';

describe('FloatingPromiseLinter', () => {
  const createLinter = (code: string, fileName = '/test/test.ts') => {
    const sourceMap = new Map<string, string>();
    sourceMap.set(fileName, code);
    return new FloatingPromiseLinter([fileName], sourceMap);
  };

  describe('detects floating promises', () => {
    it('should detect unhandled async function call', () => {
      const code = `
        async function doSomething(): Promise<void> {
          console.log('hello');
        }

        function main() {
          doSomething();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(1);
      expect(result.issues[0].functionName).toBe('doSomething');
      expect(result.issues[0].message).toContain('not awaited');
    });

    it('should detect unhandled Promise-returning function call', () => {
      const code = `
        function fetchData(): Promise<string> {
          return Promise.resolve('data');
        }

        function main() {
          fetchData();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(1);
      expect(result.issues[0].functionName).toBe('fetchData');
    });

    it('should detect unhandled method call that returns Promise', () => {
      const code = `
        class Service {
          async process(): Promise<void> {}
        }

        function main() {
          const service = new Service();
          service.process();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(1);
      expect(result.issues[0].functionName).toBe('process');
    });
  });

  describe('does not report false positives', () => {
    it('should not report awaited async function call', () => {
      const code = `
        async function doSomething(): Promise<void> {
          console.log('hello');
        }

        async function main() {
          await doSomething();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(0);
    });

    it('should not report Promise assigned to variable', () => {
      const code = `
        async function doSomething(): Promise<string> {
          return 'hello';
        }

        function main() {
          const promise = doSomething();
          return promise;
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(0);
    });

    it('should not report Promise returned from function', () => {
      const code = `
        async function doSomething(): Promise<string> {
          return 'hello';
        }

        function main(): Promise<string> {
          return doSomething();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(0);
    });

    it('should not report Promise used in then chain', () => {
      const code = `
        async function doSomething(): Promise<string> {
          return 'hello';
        }

        function main() {
          doSomething().then(result => console.log(result));
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(0);
    });

    it('should not report sync function calls', () => {
      const code = `
        function syncFunction(): void {
          console.log('hello');
        }

        function main() {
          syncFunction();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(0);
    });

    it('should not report Promise.all usage', () => {
      const code = `
        async function main() {
          await Promise.all([
            Promise.resolve(1),
            Promise.resolve(2),
          ]);
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle arrow function async calls', () => {
      const code = `
        const doSomething = async (): Promise<void> => {
          console.log('hello');
        };

        function main() {
          doSomething();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(1);
    });

    it('should handle nested async calls', () => {
      const code = `
        async function outer(): Promise<void> {}
        async function inner(): Promise<void> {}

        async function main() {
          await outer();
          inner();
        }
      `;

      const linter = createLinter(code);
      const result = linter.lint();

      expect(result.issues.length).toBe(1);
      expect(result.issues[0].functionName).toBe('inner');
    });
  });
});
