#!/usr/bin/env node

import * as fs from 'node:fs';
import consola from 'consola';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import path from 'pathe';
import * as ts from 'typescript';
import {
  type NormalizedPath,
  NormalizedPathArraySchema,
  NormalizedPathSchema,
} from './lib/paths';

export interface NeverthrowLintConfig {
  rules: Array<{
    name: string;
    path: string;
    enforceResult: boolean;
    apply: 'async-functions' | 'all-functions' | 'exported-functions';
    exceptions: string[];
  }>;
  mustUseResult?: {
    enabled: boolean;
    path: string;
  };
}

export interface NeverthrowIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  ruleName: string;
}

// Properties that identify a Result-like type
const RESULT_PROPERTIES = [
  'mapErr',
  'map',
  'andThen',
  'orElse',
  'match',
  'unwrapOr',
];

// Methods that properly handle/consume a Result
const HANDLED_METHODS = ['match', 'unwrapOr', '_unsafeUnwrap', 'isErr', 'isOk'];

export class NeverthrowLinter {
  private issues: NeverthrowIssue[] = [];
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private files: NormalizedPath[];
  private handledVariables: Set<string> = new Set();

  constructor(
    files: string[],
    private config: NeverthrowLintConfig,
    private sourceMap?: Map<string, string>, // For testing with virtual files
  ) {
    this.files = NormalizedPathArraySchema.parse(files);
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

    // If sourceMap is provided (for testing), create a custom compiler host
    if (this.sourceMap) {
      const host = this.createVirtualCompilerHost(
        compilerOptions,
        this.sourceMap,
      );
      this.program = ts.createProgram(this.files, compilerOptions, host);
    } else {
      // Production mode: use real files
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

  lint(): NeverthrowIssue[] {
    for (const sourceFile of this.program.getSourceFiles()) {
      // TypeScript compiler always returns forward slashes, so sourceFile.fileName is already normalized
      if (this.files.includes(sourceFile.fileName as NormalizedPath)) {
        this.lintFile(sourceFile);
        // Check for must-use-result if enabled
        if (this.config.mustUseResult?.enabled) {
          this.checkMustUseResult(sourceFile);
        }
      }
    }
    return this.issues;
  }

  /**
   * Check if a type is Result-like by checking for characteristic properties
   * or by string matching the type name
   */
  private isResultLikeType(type: ts.Type): boolean {
    const typeString = this.checker.typeToString(type);

    // Exclude function types that return Result (we only want actual Result values)
    // Function types look like "() => Result<...>" or "(args) => Result<...>"
    if (typeString.includes('=>')) {
      return false;
    }

    // First, try string-based matching (more reliable when module resolution is limited)
    // Use regex to match only neverthrow Result types, not other types containing "Result"
    // e.g., match "Result<string, Error>" but not "ZodSafeParseResult<...>"
    const neverthrowResultPattern =
      /^(neverthrow\.)?(Result|ResultAsync)<|^Promise<(neverthrow\.)?(Result|ResultAsync)</;
    if (neverthrowResultPattern.test(typeString)) {
      return true;
    }

    // Fallback: check for characteristic properties
    const apparentType = this.checker.getApparentType(type);

    // Check union types
    if (apparentType.isUnion()) {
      return apparentType.types.some((t) => this.hasResultProperties(t));
    }

    return this.hasResultProperties(apparentType);
  }

  private hasResultProperties(type: ts.Type): boolean {
    return RESULT_PROPERTIES.every(
      (prop) => type.getProperty(prop) !== undefined,
    );
  }

  /**
   * Check if a Result is being handled (consumed) properly
   */
  private isResultHandled(node: ts.Node): boolean {
    const parent = node.parent;

    // Case 1: Method call on Result (e.g., result.match(...))
    if (ts.isPropertyAccessExpression(parent)) {
      const methodName = parent.name.text;

      // Check if this is a handled method being called
      if (HANDLED_METHODS.includes(methodName)) {
        const grandParent = parent.parent;
        if (
          ts.isCallExpression(grandParent) &&
          grandParent.expression === parent
        ) {
          return true;
        }
      }

      // Check if it's being chained further (e.g., result.map(...).match(...))
      const grandParent = parent.parent;
      if (grandParent && !ts.isExpressionStatement(grandParent)) {
        return this.isResultHandled(grandParent);
      }
    }

    // Case 2: Assigned to a variable - track it
    if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
      if (ts.isIdentifier(parent.name)) {
        // We'll check variable usage in a second pass
        return true; // Don't report here, will be checked via variable tracking
      }
    }

    // Case 3: Returned from function
    if (ts.isReturnStatement(parent)) {
      return true;
    }

    // Case 4: Arrow function implicit return
    if (ts.isArrowFunction(parent) && parent.body === node) {
      return true;
    }

    // Case 5: Passed as argument to another function
    if (
      ts.isCallExpression(parent) &&
      parent.arguments.includes(node as ts.Expression)
    ) {
      return true;
    }

    // Case 6: Part of array literal or object literal
    if (
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent)
    ) {
      return true;
    }

    // Case 7: Spread element
    if (ts.isSpreadElement(parent)) {
      return true;
    }

    // Case 8: Await expression - check the parent of await
    if (ts.isAwaitExpression(parent)) {
      return this.isResultHandled(parent);
    }

    // Case 9: Parenthesized expression - check parent
    if (ts.isParenthesizedExpression(parent)) {
      return this.isResultHandled(parent);
    }

    return false;
  }

  /**
   * Check for must-use-result violations in a source file
   */
  private checkMustUseResult(sourceFile: ts.SourceFile) {
    // Check if this file matches the mustUseResult path pattern
    if (this.config.mustUseResult?.path) {
      const mustUsePath = this.config.mustUseResult.path;
      // If mustUsePath is absolute, compare directly
      if (path.isAbsolute(mustUsePath)) {
        if (sourceFile.fileName !== NormalizedPathSchema.parse(mustUsePath)) {
          return;
        }
      } else {
        // Otherwise, use minimatch with relative path
        const relativePath = path.relative(process.cwd(), sourceFile.fileName);
        if (!minimatch(relativePath, mustUsePath)) {
          return;
        }
      }
    }

    // First pass: collect all variable declarations with Result types and track their usage
    const resultVariables = new Map<
      string,
      { handled: boolean; node: ts.Node }
    >();

    const collectVariables = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isIdentifier(node.name)
      ) {
        const type = this.checker.getTypeAtLocation(node.initializer);
        if (this.isResultLikeType(type)) {
          resultVariables.set(node.name.text, {
            handled: false,
            node: node.initializer,
          });
        }
      }
      ts.forEachChild(node, collectVariables);
    };
    ts.forEachChild(sourceFile, collectVariables);

    // Second pass: check if variables are used with handling methods
    const checkVariableUsage = (node: ts.Node) => {
      if (ts.isIdentifier(node) && resultVariables.has(node.text)) {
        const parent = node.parent;

        // Check if this identifier is being accessed with a handling method
        if (
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node
        ) {
          const methodName = parent.name.text;
          if (HANDLED_METHODS.includes(methodName)) {
            const grandParent = parent.parent;
            if (
              ts.isCallExpression(grandParent) &&
              grandParent.expression === parent
            ) {
              const varInfo = resultVariables.get(node.text);
              if (varInfo) varInfo.handled = true;
            }
          }
          // Also mark as handled if chained with other Result methods
          if (RESULT_PROPERTIES.includes(methodName)) {
            const grandParent = parent.parent;
            if (
              ts.isCallExpression(grandParent) &&
              grandParent.expression === parent
            ) {
              // Check if the chain eventually gets handled
              if (this.isResultHandled(grandParent)) {
                const varInfo = resultVariables.get(node.text);
                if (varInfo) varInfo.handled = true;
              }
            }
          }
        }

        // Mark as handled if returned
        if (ts.isReturnStatement(parent)) {
          const varInfo = resultVariables.get(node.text);
          if (varInfo) varInfo.handled = true;
        }

        // Mark as handled if passed to function
        if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
          const varInfo = resultVariables.get(node.text);
          if (varInfo) varInfo.handled = true;
        }
      }
      ts.forEachChild(node, checkVariableUsage);
    };
    ts.forEachChild(sourceFile, checkVariableUsage);

    // Report unhandled variables
    for (const [name, info] of resultVariables) {
      if (!info.handled) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          info.node.getStart(),
        );
        this.issues.push({
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
          message: `Result assigned to '${name}' must be handled with match, unwrapOr, or _unsafeUnwrap.`,
          severity: 'error',
          ruleName: 'must-use-result',
        });
      }
    }

    // Third pass: check for expression statements that produce unhandled Results
    const checkExpressionStatements = (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
        const expr = node.expression;
        let exprToCheck = expr;

        // Handle await expressions
        if (ts.isAwaitExpression(expr)) {
          exprToCheck = expr.expression;
        }

        // Check call expressions and new expressions
        if (
          ts.isCallExpression(exprToCheck) ||
          ts.isNewExpression(exprToCheck)
        ) {
          const type = this.checker.getTypeAtLocation(exprToCheck);
          if (this.isResultLikeType(type)) {
            const { line, character } =
              sourceFile.getLineAndCharacterOfPosition(node.getStart());
            this.issues.push({
              file: sourceFile.fileName,
              line: line + 1,
              column: character + 1,
              message:
                'Result must be handled with match, unwrapOr, or _unsafeUnwrap.',
              severity: 'error',
              ruleName: 'must-use-result',
            });
          }
        }
      }
      ts.forEachChild(node, checkExpressionStatements);
    };
    ts.forEachChild(sourceFile, checkExpressionStatements);
  }

  private lintFile(sourceFile: ts.SourceFile) {
    const applicableRules = this.config.rules.filter((rule) => {
      // If rule.path is an absolute path, compare directly
      if (path.isAbsolute(rule.path)) {
        // Normalize rule.path to handle Windows backslashes
        return sourceFile.fileName === NormalizedPathSchema.parse(rule.path);
      }
      // Otherwise, use minimatch with relative path
      const relativePath = path.relative(process.cwd(), sourceFile.fileName);
      return minimatch(relativePath, rule.path);
    });

    if (applicableRules.length === 0) {
      return;
    }

    // Track functions that return ResultAsync to skip their inner callbacks
    const resultAsyncFunctionNodes = new Set<ts.Node>();

    const visit = (node: ts.Node, insideResultAsyncFunction = false) => {
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
        // Check if this function returns ResultAsync
        const returnsResultAsync = this.hasResultReturnType(node);

        // Skip checking nested arrow functions that are:
        // 1. Inside a function that returns ResultAsync
        // 2. Used as arguments to ResultAsync.fromPromise() or similar
        // 3. Callbacks passed to other function calls (common pattern for utility functions)
        if (insideResultAsyncFunction && ts.isArrowFunction(node)) {
          // This is a nested async function inside a ResultAsync-returning function
          // Skip checking it as it's likely an IIFE or callback for ResultAsync
          if (
            this.isInsideNeverthrowCall(node) ||
            this.isCallbackArgument(node)
          ) {
            // Recurse but still mark as inside ResultAsync function
            ts.forEachChild(node, (child) => visit(child, true));
            return;
          }
        }

        if (returnsResultAsync) {
          resultAsyncFunctionNodes.add(node);
        }

        this.checkFunction(node, sourceFile, applicableRules);

        // Recurse with updated context
        ts.forEachChild(node, (child) =>
          visit(child, returnsResultAsync || insideResultAsyncFunction),
        );
        return;
      }

      if (ts.isVariableStatement(node)) {
        // Check for arrow function assignments
        for (const declaration of node.declarationList.declarations) {
          if (
            declaration.initializer &&
            ts.isArrowFunction(declaration.initializer)
          ) {
            const returnsResultAsync = this.hasResultReturnType(
              declaration.initializer,
            );

            if (returnsResultAsync) {
              resultAsyncFunctionNodes.add(declaration.initializer);
            }

            this.checkFunction(
              declaration.initializer,
              sourceFile,
              applicableRules,
              declaration.name,
            );

            // Recurse into the arrow function body
            ts.forEachChild(declaration.initializer, (child) =>
              visit(child, returnsResultAsync || insideResultAsyncFunction),
            );
          }
        }
        // Continue visiting other children of the variable statement
        ts.forEachChild(node, (child) => {
          if (!ts.isVariableDeclarationList(child)) {
            visit(child, insideResultAsyncFunction);
          }
        });
        return;
      }

      ts.forEachChild(node, (child) => visit(child, insideResultAsyncFunction));
    };

    ts.forEachChild(sourceFile, (node) => visit(node, false));
  }

  /**
   * Check if an arrow function is used as an argument to neverthrow utility functions
   * like ResultAsync.fromPromise(), ResultAsync.fromSafePromise(), etc.
   */
  private isInsideNeverthrowCall(node: ts.ArrowFunction): boolean {
    let parent = node.parent;

    while (parent) {
      if (ts.isCallExpression(parent)) {
        const expr = parent.expression;

        // Check for ResultAsync.fromPromise, ResultAsync.fromSafePromise, etc.
        if (ts.isPropertyAccessExpression(expr)) {
          const methodName = expr.name.text;
          const neverthrowMethods = [
            'fromPromise',
            'fromSafePromise',
            'fromThrowable',
            'map',
            'mapErr',
            'andThen',
            'orElse',
            'match',
          ];

          if (neverthrowMethods.includes(methodName)) {
            return true;
          }
        }
      }

      parent = parent.parent;
    }

    return false;
  }

  /**
   * Check if an arrow function is passed as an argument to any function call.
   * This is common for callbacks that don't need to return Result themselves
   * when the parent function handles error wrapping.
   */
  private isCallbackArgument(node: ts.ArrowFunction): boolean {
    const parent = node.parent;

    // Direct argument to a call expression
    if (ts.isCallExpression(parent)) {
      return parent.arguments.some((arg) => arg === node);
    }

    return false;
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

export async function loadConfig(
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

// Export for testing with virtual files
export async function lintNeverthrowFromSource(
  sources: Map<string, string>,
  config: NeverthrowLintConfig,
): Promise<{
  issues: NeverthrowIssue[];
  success: boolean;
  message?: string;
}> {
  const files = Array.from(sources.keys());
  const linter = new NeverthrowLinter(files, config, sources);
  const issues = linter.lint();

  const success = issues.filter((i) => i.severity === 'error').length === 0;
  const message =
    issues.length === 0
      ? '✔ All functions follow neverthrow error handling pattern!'
      : undefined;

  return {
    issues,
    success,
    message,
  };
}

// Export for testing
export async function lintNeverthrow(config: NeverthrowLintConfig): Promise<{
  issues: NeverthrowIssue[];
  success: boolean;
  message?: string;
}> {
  // Collect all unique path patterns
  const patterns = new Set<string>();
  for (const rule of config.rules) {
    patterns.add(rule.path);
  }
  // Also include mustUseResult path if enabled
  if (config.mustUseResult?.enabled && config.mustUseResult.path) {
    patterns.add(config.mustUseResult.path);
  }

  // Convert Set to Array for processing
  const patternArray = Array.from(patterns).map((pattern) => {
    // Normalize path separators for cross-platform compatibility
    return pattern.replace(/\\/g, '/');
  });

  // Check if all patterns are specific files (not glob patterns)
  const isSpecificFiles = patternArray.every(
    (p) => !p.includes('*') && !p.includes('!'),
  );

  let allFiles: string[];

  if (isSpecificFiles) {
    // Use specific files directly (for testing)
    // Ensure they are absolute paths
    allFiles = patternArray.map((file) => {
      if (path.isAbsolute(file)) {
        return file;
      }
      return path.join(process.cwd(), file);
    });
  } else {
    // Use glob for patterns
    const files = await glob(patternArray, {
      cwd: process.cwd(),
      absolute: true,
      ignore: [
        'node_modules/**',
        'dist/**',
        'main/**',
        'out/**',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      // Important for Windows: don't escape special characters
      windowsPathsNoEscape: true,
    });
    allFiles = [...files];
  }

  if (allFiles.length === 0) {
    consola.warn('No files found matching the configured patterns');
    return {
      issues: [],
      success: true,
      message: '✔ All functions follow neverthrow error handling pattern!',
    };
  }

  const linter = new NeverthrowLinter(allFiles, config);
  const issues = linter.lint();

  const success = issues.filter((i) => i.severity === 'error').length === 0;
  const message =
    issues.length === 0
      ? '✔ All functions follow neverthrow error handling pattern!'
      : undefined;

  return {
    issues,
    success,
    message,
  };
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
  const { issues, success } = await lintNeverthrow(config);

  if (issues.length === 0) {
    console.log('✔ All functions follow neverthrow error handling pattern!');
    console.log('');
    console.log(
      'ℹ ⚠️  Important: Only wrap expected/handleable errors in Result types.',
    );
    console.log(
      'ℹ    Unexpected errors should be re-thrown to ensure Sentry reporting.',
    );
    console.log(
      'ℹ    Exception: If error is logged with logger.error() before returning,',
    );
    console.log(
      'ℹ    generic Error type is acceptable (Sentry-notified error).',
    );
    console.log('ℹ    See: docs/lint-neverthrow.md for best practices.');
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
    process.exit(success ? 0 : 1);
  }
}

// Only run main if this file is being executed directly
// Check if running as main module (ES module compatible)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    consola.error('Linter failed:', error);
    process.exit(1);
  });
}
