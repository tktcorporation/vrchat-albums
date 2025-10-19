#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import consola from 'consola';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import * as ts from 'typescript';

interface NeverthrowLintConfig {
  rules: Array<{
    name: string;
    path: string;
    enforceResult: boolean;
    apply: 'async-functions' | 'all-functions' | 'exported-functions';
    exceptions: string[];
  }>;
}

interface NeverthrowIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  ruleName: string;
}

class NeverthrowLinter {
  private issues: NeverthrowIssue[] = [];
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(
    private files: string[],
    private config: NeverthrowLintConfig,
  ) {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: false,
      checkJs: false,
      strict: true,
      skipLibCheck: true,
      resolveJsonModule: true,
    };

    this.program = ts.createProgram(files, compilerOptions);
    this.checker = this.program.getTypeChecker();
  }

  lint(): NeverthrowIssue[] {
    for (const sourceFile of this.program.getSourceFiles()) {
      if (this.files.includes(sourceFile.fileName)) {
        this.lintFile(sourceFile);
      }
    }
    return this.issues;
  }

  private lintFile(sourceFile: ts.SourceFile) {
    const applicableRules = this.config.rules.filter((rule) => {
      const relativePath = path.relative(process.cwd(), sourceFile.fileName);
      return minimatch(relativePath, rule.path);
    });

    if (applicableRules.length === 0) {
      return;
    }

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
        this.checkFunction(node, sourceFile, applicableRules);
      } else if (ts.isVariableStatement(node)) {
        // Check for arrow function assignments
        for (const declaration of node.declarationList.declarations) {
          if (
            declaration.initializer &&
            ts.isArrowFunction(declaration.initializer)
          ) {
            this.checkFunction(
              declaration.initializer,
              sourceFile,
              applicableRules,
              declaration.name,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  private checkFunction(
    node: ts.FunctionDeclaration | ts.ArrowFunction,
    sourceFile: ts.SourceFile,
    rules: NeverthrowLintConfig['rules'],
    variableName?: ts.BindingName,
  ) {
    for (const rule of rules) {
      // Get function name
      let functionName: string | undefined;
      if (ts.isFunctionDeclaration(node) && node.name) {
        functionName = node.name.text;
      } else if (variableName && ts.isIdentifier(variableName)) {
        functionName = variableName.text;
      } else if (ts.isArrowFunction(node)) {
        // Try to find the variable name from parent nodes
        functionName = this.findVariableNameFromParent(node);
      }

      // Check if function is in exceptions
      if (functionName && rule.exceptions.includes(functionName)) {
        continue;
      }

      // Check if function should be checked based on 'apply' setting
      const isExported = this.isExportedFunction(node, sourceFile);
      const isAsync = this.isAsyncFunction(node);

      let shouldCheck = false;
      if (rule.apply === 'all-functions') {
        shouldCheck = true;
      } else if (rule.apply === 'exported-functions') {
        shouldCheck = isExported;
      } else if (rule.apply === 'async-functions') {
        shouldCheck = isAsync;
      }

      if (!shouldCheck) {
        continue;
      }

      // Check if return type includes Result
      if (rule.enforceResult) {
        const hasResultType = this.hasResultReturnType(node);
        if (!hasResultType) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(),
          );
          const functionNameDisplay = functionName || '(anonymous)';

          // Avoid duplicate issues for the same position
          const isDuplicate = this.issues.some(
            (issue) =>
              issue.file === sourceFile.fileName &&
              issue.line === line + 1 &&
              issue.column === character + 1,
          );

          if (!isDuplicate) {
            this.issues.push({
              file: sourceFile.fileName,
              line: line + 1,
              column: character + 1,
              message: `Function '${functionNameDisplay}' should return Result<T, E> type from neverthrow (Rule: ${rule.name})`,
              severity: 'error',
              ruleName: rule.name,
            });
          }
        } else {
          // If function returns Result type, check for generic error types
          const hasGenericError = this.hasGenericErrorType(node);
          if (hasGenericError) {
            const { line, character } =
              sourceFile.getLineAndCharacterOfPosition(node.getStart());
            const functionNameDisplay = functionName || '(anonymous)';

            const isDuplicate = this.issues.some(
              (issue) =>
                issue.file === sourceFile.fileName &&
                issue.line === line + 1 &&
                issue.column === character + 1 &&
                issue.ruleName === 'Generic error type',
            );

            if (!isDuplicate) {
              this.issues.push({
                file: sourceFile.fileName,
                line: line + 1,
                column: character + 1,
                message: `Function '${functionNameDisplay}' uses generic error type (Error, any, or unknown). Use specific error union types for proper error classification. Exception: If error is logged to Sentry with logger.error() before returning, generic Error type is acceptable.`,
                severity: 'warning',
                ruleName: 'Generic error type',
              });
            }
          }

          // If function returns Result type, check for catch-err anti-pattern
          this.checkCatchBlockAntiPattern(node, sourceFile, functionName);
        }
      }
    }
  }

  private findVariableNameFromParent(
    node: ts.ArrowFunction,
  ): string | undefined {
    let parent = node.parent;
    while (parent) {
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      parent = parent.parent;
    }
    return undefined;
  }

  private isExportedFunction(
    node: ts.FunctionDeclaration | ts.ArrowFunction,
    _sourceFile: ts.SourceFile,
  ): boolean {
    if (ts.isFunctionDeclaration(node)) {
      return (
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
        false
      );
    }

    // For arrow functions, check if the parent variable statement is exported
    let parent = node.parent;
    while (parent) {
      if (ts.isVariableStatement(parent)) {
        return (
          parent.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword,
          ) || false
        );
      }
      parent = parent.parent;
    }

    return false;
  }

  private isAsyncFunction(
    node: ts.FunctionDeclaration | ts.ArrowFunction,
  ): boolean {
    // Check for async modifier
    const hasAsyncModifier =
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ||
      false;

    if (hasAsyncModifier) {
      return true;
    }

    // Check if return type is Promise
    if (node.type) {
      const typeText = node.type.getText();
      return typeText.includes('Promise<');
    }

    return false;
  }

  private hasResultReturnType(
    node: ts.FunctionDeclaration | ts.ArrowFunction,
  ): boolean {
    // Check explicit return type annotation
    if (node.type) {
      const typeText = node.type.getText();
      // Check for neverthrow.Result<T, E> or Result<T, E> or Promise<neverthrow.Result<T, E>>
      const hasResult =
        /neverthrow\.Result</.test(typeText) ||
        /\bResult</.test(typeText) ||
        /ResultAsync</.test(typeText) ||
        /neverthrow\.ResultAsync</.test(typeText);

      return hasResult;
    }

    // Try to infer the type
    try {
      const signature = this.checker.getSignatureFromDeclaration(node);
      if (signature) {
        const returnType = this.checker.getReturnTypeOfSignature(signature);
        const typeString = this.checker.typeToString(returnType);

        return (
          typeString.includes('Result<') ||
          typeString.includes('ResultAsync<') ||
          typeString.includes('neverthrow.Result') ||
          typeString.includes('neverthrow.ResultAsync')
        );
      }
    } catch (_error) {
      // Type inference failed, skip
    }

    return false;
  }

  /**
   * Check if Result type uses generic error types (Error, any, unknown)
   * These are red flags indicating improper error classification
   */
  private hasGenericErrorType(
    node: ts.FunctionDeclaration | ts.ArrowFunction,
  ): boolean {
    if (!node.type) return false;

    const typeText = node.type.getText();

    // Extract error type from Result<T, E> or Promise<Result<T, E>>
    // Match patterns like Result<string, Error>, Result<Data, any>, etc.
    const resultPattern =
      /(?:neverthrow\.)?(?:Result|ResultAsync)<[^,>]+,\s*([^>]+)>/;
    const match = typeText.match(resultPattern);

    if (!match) return false;

    const errorType = match[1].trim();

    // Check if error type is generic
    return (
      errorType === 'Error' ||
      errorType === 'any' ||
      errorType === 'unknown' ||
      // Also catch wrapped versions
      errorType === 'Promise<Error>' ||
      errorType === 'Promise<any>' ||
      errorType === 'Promise<unknown>'
    );
  }

  /**
   * Check for anti-pattern: catching errors and wrapping them in err() without classification
   */
  private checkCatchBlockAntiPattern(
    node: ts.FunctionDeclaration | ts.ArrowFunction,
    sourceFile: ts.SourceFile,
    functionName: string | undefined,
  ) {
    if (!node.body) return;

    const visit = (n: ts.Node) => {
      // Look for try-catch statements
      if (ts.isTryStatement(n) && n.catchClause) {
        const catchClause = n.catchClause;
        const catchBlock = catchClause.block;

        // Check if catch block contains err() call without error classification
        let hasErrCall = false;
        let hasThrow = false;
        let hasIfStatement = false;

        const visitCatchBlock = (catchNode: ts.Node) => {
          // Check for err() or neverthrow.err() calls
          if (ts.isCallExpression(catchNode)) {
            const expr = catchNode.expression;
            if (
              (ts.isIdentifier(expr) && expr.text === 'err') ||
              (ts.isPropertyAccessExpression(expr) &&
                expr.name.text === 'err' &&
                ts.isIdentifier(expr.expression) &&
                expr.expression.text === 'neverthrow')
            ) {
              hasErrCall = true;
            }
          }

          // Check for throw statements
          if (ts.isThrowStatement(catchNode)) {
            hasThrow = true;
          }

          // Check for if statements (error classification)
          if (ts.isIfStatement(catchNode)) {
            hasIfStatement = true;
          }

          ts.forEachChild(catchNode, visitCatchBlock);
        };

        ts.forEachChild(catchBlock, visitCatchBlock);

        // Report issue if err() is called without proper error classification
        // Even if match() exists, if it's only checking instanceof Error, it's not real classification
        if (hasErrCall && !hasThrow && !hasIfStatement) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            catchBlock.getStart(),
          );
          const functionNameDisplay = functionName || '(anonymous)';

          // Avoid duplicate issues
          const isDuplicate = this.issues.some(
            (issue) =>
              issue.file === sourceFile.fileName &&
              issue.line === line + 1 &&
              issue.column === character + 1 &&
              issue.ruleName === 'No catch-err anti-pattern',
          );

          if (!isDuplicate) {
            this.issues.push({
              file: sourceFile.fileName,
              line: line + 1,
              column: character + 1,
              message: `Function '${functionNameDisplay}' catches errors and wraps them in err() without proper classification. Expected errors should be classified by error type/code (not just instanceof Error), unexpected errors should be re-thrown.`,
              severity: 'error',
              ruleName: 'No catch-err anti-pattern',
            });
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    ts.forEachChild(node.body, visit);
  }
}

async function loadConfig(
  customConfigPath?: string,
): Promise<NeverthrowLintConfig> {
  const configPath =
    customConfigPath || path.join(process.cwd(), '.neverthrowlintrc.json');

  if (!fs.existsSync(configPath)) {
    consola.warn('No .neverthrowlintrc.json found, using default config');
    return {
      rules: [
        {
          name: 'Service layer must use neverthrow Result type',
          path: 'electron/module/**/service.ts',
          enforceResult: true,
          apply: 'async-functions',
          exceptions: [],
        },
      ],
    };
  }

  const configContent = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configContent);
}

async function main() {
  consola.start('Linting neverthrow usage...');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const customConfigPath =
    configIndex !== -1 && args[configIndex + 1]
      ? args[configIndex + 1]
      : undefined;

  const config = await loadConfig(customConfigPath);

  // Collect all unique path patterns
  const patterns = new Set<string>();
  for (const rule of config.rules) {
    patterns.add(rule.path);
  }

  // Find all TypeScript files matching the patterns
  const allFiles: string[] = [];
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: process.cwd(),
      absolute: true,
      ignore: [
        'node_modules/**',
        'dist/**',
        'main/**',
        'out/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.integration.test.ts',
      ],
    });
    allFiles.push(...files);
  }

  const uniqueFiles = [...new Set(allFiles)];

  if (uniqueFiles.length === 0) {
    consola.warn('No files found matching the configured patterns');
    process.exit(0);
  }

  consola.info(`Checking ${uniqueFiles.length} files...`);

  const linter = new NeverthrowLinter(uniqueFiles, config);
  const issues = linter.lint();

  if (issues.length === 0) {
    consola.success('All functions follow neverthrow error handling pattern!');
    console.log('');
    consola.info(
      '⚠️  Important: Only wrap expected/handleable errors in Result types.',
    );
    consola.info(
      '   Unexpected errors should be re-thrown to ensure Sentry reporting.',
    );
    consola.info(
      '   Exception: If error is logged with logger.error() before returning,',
    );
    consola.info(
      '   generic Error type is acceptable (Sentry-notified error).',
    );
    consola.info('   See: docs/lint-neverthrow.md for best practices.');
    process.exit(0);
  } else {
    consola.error(`Found ${issues.length} issues:`);

    // Group issues by file
    const issuesByFile = new Map<string, NeverthrowIssue[]>();
    for (const issue of issues) {
      const existing = issuesByFile.get(issue.file) || [];
      existing.push(issue);
      issuesByFile.set(issue.file, existing);
    }

    // Output each issue with clickable file path
    for (const [file, fileIssues] of issuesByFile.entries()) {
      const relativePath = path.relative(process.cwd(), file);
      console.log(`\n📄 ${relativePath}`);
      for (const issue of fileIssues) {
        const icon = issue.severity === 'error' ? '❌' : '⚠️';
        console.log(
          `  ${icon} ${issue.line}:${issue.column} - ${issue.message}`,
        );
      }
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    console.log(
      `\n❌ ${errorCount} errors, ${issues.length - errorCount} warnings`,
    );
    process.exit(errorCount > 0 ? 1 : 0);
  }
}

main().catch((error) => {
  consola.error('Linter failed:', error);
  process.exit(1);
});
