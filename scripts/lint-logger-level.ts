#!/usr/bin/env node

/**
 * Logger Level Linter
 *
 * Detects when logger.warn() is used in catch blocks that return
 * 'unexpected_error' as the reason. Unexpected errors should use
 * logger.error() to ensure Sentry reporting.
 */

import consola from 'consola';
import { glob } from 'glob';
import * as ts from 'typescript';
import { type NormalizedPath, NormalizedPathArraySchema } from './lib/paths';

export interface LoggerLevelIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  warnLine: number;
  returnLine: number;
}

export interface LoggerLevelLintResult {
  success: boolean;
  issues: LoggerLevelIssue[];
}

export class LoggerLevelLinter {
  private issues: LoggerLevelIssue[] = [];
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

  lint(): LoggerLevelLintResult {
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
      if (ts.isCatchClause(node)) {
        this.analyzeCatchBlock(node, sourceFile);
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  private analyzeCatchBlock(
    catchClause: ts.CatchClause,
    sourceFile: ts.SourceFile,
  ) {
    const block = catchClause.block;

    const warnCalls: ts.CallExpression[] = [];
    const returnStatements: ts.ReturnStatement[] = [];

    const collectNodes = (node: ts.Node) => {
      if (ts.isCallExpression(node) && this.isLoggerWarnCall(node)) {
        warnCalls.push(node);
      }
      if (ts.isReturnStatement(node)) {
        returnStatements.push(node);
      }
      ts.forEachChild(node, collectNodes);
    };

    ts.forEachChild(block, collectNodes);

    for (const returnStmt of returnStatements) {
      if (this.hasUnexpectedErrorReason(returnStmt)) {
        for (const warnCall of warnCalls) {
          const warnPos = warnCall.getStart(sourceFile);
          const { line: warnLine, character: warnCol } =
            sourceFile.getLineAndCharacterOfPosition(warnPos);

          const returnPos = returnStmt.getStart(sourceFile);
          const { line: returnLine } =
            sourceFile.getLineAndCharacterOfPosition(returnPos);

          this.issues.push({
            file: sourceFile.fileName,
            line: warnLine + 1,
            column: warnCol + 1,
            message:
              "logger.warn() used with 'unexpected_error' reason. Use logger.error() for unexpected errors to ensure Sentry reporting.",
            severity: 'error',
            warnLine: warnLine + 1,
            returnLine: returnLine + 1,
          });
        }
      }
    }
  }

  private isLoggerWarnCall(node: ts.CallExpression): boolean {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      if (expr.name.text === 'warn') {
        if (
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === 'logger'
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private hasUnexpectedErrorReason(returnStmt: ts.ReturnStatement): boolean {
    if (!returnStmt.expression) return false;

    const checkNode = (node: ts.Node): boolean => {
      if (ts.isPropertyAssignment(node)) {
        if (ts.isIdentifier(node.name) && node.name.text === 'reason') {
          if (
            ts.isStringLiteral(node.initializer) &&
            node.initializer.text === 'unexpected_error'
          ) {
            return true;
          }
          if (ts.isAsExpression(node.initializer)) {
            const innerExpr = node.initializer.expression;
            if (
              ts.isStringLiteral(innerExpr) &&
              innerExpr.text === 'unexpected_error'
            ) {
              return true;
            }
          }
        }
      }

      let found = false;
      ts.forEachChild(node, (child) => {
        if (checkNode(child)) {
          found = true;
        }
      });
      return found;
    };

    return checkNode(returnStmt.expression);
  }
}

export async function lintLoggerLevel(
  projectRoot?: string,
): Promise<LoggerLevelLintResult> {
  const root = projectRoot ?? process.cwd();

  const files = await glob(['electron/**/*.ts'], {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
  });

  const linter = new LoggerLevelLinter(files);
  return linter.lint();
}

const isDirectRun =
  process.argv[1]?.endsWith('lint-logger-level.ts') ||
  process.argv[1]?.endsWith('lint-logger-level.js');

if (isDirectRun) {
  const result = await lintLoggerLevel();

  if (result.issues.length > 0) {
    consola.error(`Found ${result.issues.length} logger level issue(s):\n`);

    for (const issue of result.issues) {
      const location = `${issue.file}:${issue.line}:${issue.column}`;
      consola.error(`  ${location}: ${issue.severity}: ${issue.message}`);
    }

    process.exit(1);
  }

  consola.success('No logger level issues found.');
  process.exit(0);
}
