#!/usr/bin/env node

/**
 * ts-pattern .exhaustive() Linter
 *
 * Detects match() chains that use .otherwise() without .exhaustive().
 * The recommendation is to use .exhaustive() for type safety before .otherwise().
 */

import consola from 'consola';
import { glob } from 'glob';
import * as ts from 'typescript';
import { type NormalizedPath, NormalizedPathArraySchema } from './lib/paths';

export interface TsPatternIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface TsPatternLintResult {
  success: boolean;
  issues: TsPatternIssue[];
}

export class TsPatternLinter {
  private issues: TsPatternIssue[] = [];
  private program: ts.Program;
  private files: NormalizedPath[];

  constructor(
    files: string[],
    private sourceMap?: Map<string, string>,
  ) {
    this.files = NormalizedPathArraySchema.parse(files);
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: false,
      checkJs: false,
      strict: true,
      skipLibCheck: true,
    };

    if (this.sourceMap) {
      const host = this.createVirtualCompilerHost(
        compilerOptions,
        this.sourceMap,
      );
      this.program = ts.createProgram(this.files, compilerOptions, host);
    } else {
      this.program = ts.createProgram(this.files, compilerOptions);
    }
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

  lint(): TsPatternLintResult {
    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        !sourceFile.isDeclarationFile &&
        this.files.includes(sourceFile.fileName as NormalizedPath)
      ) {
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
      if (ts.isCallExpression(node)) {
        if (this.isOtherwiseCall(node)) {
          if (this.isMatchChain(node) && !this.hasExhaustiveInChain(node)) {
            // Get position of the .otherwise property access for accurate line reporting
            const expr = node.expression;
            const pos = ts.isPropertyAccessExpression(expr)
              ? expr.name.getStart(sourceFile)
              : node.getStart(sourceFile);

            const { line, character } =
              sourceFile.getLineAndCharacterOfPosition(pos);

            this.issues.push({
              file: sourceFile.fileName,
              line: line + 1,
              column: character + 1,
              message:
                'match() chain uses .otherwise() without .exhaustive(). Consider adding .exhaustive() for type safety.',
              severity: 'warning',
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  private isOtherwiseCall(node: ts.CallExpression): boolean {
    if (ts.isPropertyAccessExpression(node.expression)) {
      return node.expression.name.text === 'otherwise';
    }
    return false;
  }

  private isMatchChain(node: ts.CallExpression): boolean {
    let current: ts.Node = node;

    while (current) {
      if (ts.isCallExpression(current)) {
        const expr = current.expression;
        if (ts.isIdentifier(expr) && expr.text === 'match') {
          return true;
        }
        if (ts.isPropertyAccessExpression(expr)) {
          current = expr.expression;
          continue;
        }
      }
      break;
    }

    return false;
  }

  private hasExhaustiveInChain(node: ts.CallExpression): boolean {
    let current: ts.Node = node;

    while (current) {
      if (ts.isCallExpression(current)) {
        const expr = current.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          if (expr.name.text === 'exhaustive') {
            return true;
          }
          current = expr.expression;
          continue;
        }
      }
      break;
    }

    return false;
  }
}

export async function lintTsPattern(
  projectRoot?: string,
): Promise<TsPatternLintResult> {
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
      ],
    },
  );

  const linter = new TsPatternLinter(files);
  return linter.lint();
}

const isDirectRun =
  process.argv[1]?.endsWith('lint-ts-pattern.ts') ||
  process.argv[1]?.endsWith('lint-ts-pattern.js');

if (isDirectRun) {
  const result = await lintTsPattern();

  if (result.issues.length > 0) {
    consola.warn(`Found ${result.issues.length} ts-pattern issue(s):\n`);

    for (const issue of result.issues) {
      const location = `${issue.file}:${issue.line}:${issue.column}`;
      consola.warn(`  ${location}: ${issue.severity}: ${issue.message}`);
    }

    // Exit with 0 since these are warnings, not errors
    process.exit(0);
  }

  consola.success('No ts-pattern issues found.');
  process.exit(0);
}
