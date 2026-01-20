#!/usr/bin/env node

/**
 * Floating Promises Linter
 *
 * await されていない非同期関数呼び出しを検出するリンター。
 * Promise を返す関数が await なしで呼び出されると、
 * 呼び出し元が完了を待たずに処理が続行されるバグを防止する。
 *
 * 例:
 *   emitStageStart('stage', 'message'); // ❌ await がない
 *   await emitStageStart('stage', 'message'); // ✅ 正しく await されている
 */

import consola from 'consola';
import { glob } from 'glob';
import * as ts from 'typescript';
import {
  type NormalizedPath,
  NormalizedPathArraySchema,
  NormalizedPathSchema,
} from './lib/paths';

export interface FloatingPromiseIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  functionName: string;
  severity: 'error' | 'warning';
}

export interface FloatingPromiseLintResult {
  success: boolean;
  issues: FloatingPromiseIssue[];
}

export class FloatingPromiseLinter {
  private issues: FloatingPromiseIssue[] = [];
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private files: NormalizedPath[];
  private projectRoot: string;

  constructor(
    files: string[],
    private sourceMap?: Map<string, string>,
    projectRoot?: string,
  ) {
    this.files = NormalizedPathArraySchema.parse(files);
    this.projectRoot = projectRoot ?? process.cwd();

    // Read tsconfig.json to get proper compiler options
    const configPath = ts.findConfigFile(
      this.projectRoot,
      ts.sys.fileExists,
      'tsconfig.json',
    );

    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: false,
      checkJs: false,
      strict: true,
      skipLibCheck: true,
    };

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (configFile.error) {
        consola.warn(
          `Failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`,
        );
      } else {
        const parsedConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          this.projectRoot,
        );
        compilerOptions = {
          ...parsedConfig.options,
          skipLibCheck: true,
        };
      }
    }

    if (this.sourceMap) {
      const host = this.createVirtualCompilerHost(
        compilerOptions,
        this.sourceMap,
      );
      this.program = ts.createProgram(this.files, compilerOptions, host);
    } else {
      this.program = ts.createProgram(this.files, compilerOptions);
    }

    this.checker = this.program.getTypeChecker();
  }

  private createVirtualCompilerHost(
    options: ts.CompilerOptions,
    sourceMap: Map<string, string>,
  ): ts.CompilerHost {
    const defaultHost = ts.createCompilerHost(options);

    return {
      ...defaultHost,
      fileExists: (fileName: string) => {
        return sourceMap.has(fileName) || defaultHost.fileExists(fileName);
      },
      readFile: (fileName: string) => {
        const virtualContent = sourceMap.get(fileName);
        if (virtualContent !== undefined) {
          return virtualContent;
        }
        return defaultHost.readFile(fileName);
      },
      getSourceFile: (fileName: string, languageVersion: ts.ScriptTarget) => {
        const virtualContent = sourceMap.get(fileName);
        if (virtualContent !== undefined) {
          return ts.createSourceFile(
            fileName,
            virtualContent,
            languageVersion,
            true,
          );
        }
        return defaultHost.getSourceFile(fileName, languageVersion);
      },
    };
  }

  lint(): FloatingPromiseLintResult {
    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;

      // Windows互換性のためパスを正規化
      const normalizedResult = NormalizedPathSchema.safeParse(
        sourceFile.fileName,
      );
      if (!normalizedResult.success) continue;

      if (this.files.includes(normalizedResult.data)) {
        this.lintFile(sourceFile);
      }
    }

    return {
      success: this.issues.length === 0,
      issues: this.issues,
    };
  }

  private lintFile(sourceFile: ts.SourceFile) {
    const visit = (node: ts.Node) => {
      // Check for expression statements that contain unhandled promises
      if (ts.isExpressionStatement(node)) {
        const expr = node.expression;

        // Skip if it's already an await expression
        if (ts.isAwaitExpression(expr)) {
          ts.forEachChild(node, visit);
          return;
        }

        // Check if the expression is a call that returns a Promise
        if (ts.isCallExpression(expr)) {
          // Skip if Promise is handled via .then(), .catch(), or .finally()
          if (this.isPromiseHandledViaChain(expr)) {
            ts.forEachChild(node, visit);
            return;
          }

          // Skip if there's a suppression comment
          if (this.hasSuppressionComment(node, sourceFile)) {
            ts.forEachChild(node, visit);
            return;
          }

          if (this.isUnhandledPromise(expr)) {
            const functionName = this.getFunctionName(expr);
            const { line, character } =
              sourceFile.getLineAndCharacterOfPosition(expr.getStart());

            this.issues.push({
              file: sourceFile.fileName,
              line: line + 1,
              column: character + 1,
              message: `Unhandled Promise: '${functionName}()' returns a Promise but is not awaited. Add 'await' to ensure the async operation completes before continuing.`,
              functionName,
              severity: 'error',
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  /**
   * Check if the Promise is handled via .then(), .catch(), or .finally()
   */
  private isPromiseHandledViaChain(node: ts.CallExpression): boolean {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      const methodName = expr.name.text;
      if (['then', 'catch', 'finally'].includes(methodName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if there's a suppression comment on the line
   */
  private hasSuppressionComment(
    node: ts.Node,
    sourceFile: ts.SourceFile,
  ): boolean {
    const nodeText = sourceFile.text;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    // Get the text of the current line
    const lines = nodeText.split('\n');
    const currentLine = lines[line] || '';

    // Check for suppression comment
    return (
      currentLine.includes('// floating-promise-ok') ||
      currentLine.includes('/* floating-promise-ok */')
    );
  }

  private isUnhandledPromise(node: ts.CallExpression): boolean {
    try {
      const type = this.checker.getTypeAtLocation(node);
      return this.isPromiseType(type);
    } catch {
      // If type checking fails, don't report an error
      return false;
    }
  }

  private isPromiseType(type: ts.Type): boolean {
    // Check if type is a Promise
    const symbol = type.getSymbol();
    if (symbol?.getName() === 'Promise') {
      return true;
    }

    // Check if it's a union type containing Promise
    if (type.isUnion()) {
      return type.types.some((t) => this.isPromiseType(t));
    }

    // Check the type as string (fallback)
    const typeString = this.checker.typeToString(type);
    return (
      typeString.startsWith('Promise<') ||
      typeString.includes('Promise<') ||
      typeString === 'Promise'
    );
  }

  private getFunctionName(node: ts.CallExpression): string {
    const expr = node.expression;

    if (ts.isIdentifier(expr)) {
      return expr.text;
    }

    if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.text;
    }

    if (ts.isElementAccessExpression(expr)) {
      const arg = expr.argumentExpression;
      if (ts.isStringLiteral(arg)) {
        return arg.text;
      }
    }

    return '<anonymous>';
  }
}

export async function lintFloatingPromises(
  projectRoot?: string,
): Promise<FloatingPromiseLintResult> {
  const root = projectRoot ?? process.cwd();

  const files = await glob(
    ['electron/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
    {
      cwd: root,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.test.tsx',
        '**/*.spec.tsx',
      ],
    },
  );

  const linter = new FloatingPromiseLinter(files, undefined, root);
  return linter.lint();
}

const isDirectRun =
  process.argv[1]?.endsWith('lint-floating-promises.ts') ||
  process.argv[1]?.endsWith('lint-floating-promises.js');

if (isDirectRun) {
  const result = await lintFloatingPromises();

  if (result.issues.length > 0) {
    // Treat as warnings (exit code 0) to allow existing codebase to pass
    // Use `// floating-promise-ok` comment to suppress specific cases
    consola.warn(`Found ${result.issues.length} floating promise(s):\n`);

    // Group by file
    const byFile = new Map<string, FloatingPromiseIssue[]>();
    for (const issue of result.issues) {
      const existing = byFile.get(issue.file) || [];
      existing.push(issue);
      byFile.set(issue.file, existing);
    }

    for (const [file, issues] of byFile) {
      consola.warn(`\n📄 ${file}`);
      for (const issue of issues) {
        consola.warn(`  ⚠️ ${issue.line}:${issue.column} - ${issue.message}`);
      }
    }

    consola.info(
      '\n💡 Tip: Add "await" before async function calls to fix these issues.',
    );
    consola.info(
      '   Or add "// floating-promise-ok" comment to suppress intentional fire-and-forget calls.\n',
    );

    // Exit with 0 (warnings only) to not break CI
    // Change to exit(1) when all existing issues are fixed
    process.exit(0);
  }

  consola.success('No floating promises found.');
  process.exit(0);
}
