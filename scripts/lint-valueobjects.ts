#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import consola from 'consola';
import { glob } from 'glob';
import * as ts from 'typescript';

interface ValueObjectIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

class ValueObjectLinter {
  private issues: ValueObjectIssue[] = [];
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private resolvedTypes = new Map<ts.Type, boolean>();

  constructor(private files: string[]) {
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

  lint(): ValueObjectIssue[] {
    for (const sourceFile of this.program.getSourceFiles()) {
      if (this.files.includes(sourceFile.fileName)) {
        this.lintFile(sourceFile);
      }
    }
    return this.issues;
  }

  private lintFile(sourceFile: ts.SourceFile) {
    const valueObjectClasses = new Map<string, ts.ClassDeclaration>();

    // First pass: collect all ValueObject classes
    const collectClasses = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        if (this.extendsBaseValueObject(node)) {
          valueObjectClasses.set(node.name.text, node);
        }
        this.checkClassDeclaration(node, sourceFile);
      }
      ts.forEachChild(node, collectClasses);
    };
    ts.forEachChild(sourceFile, collectClasses);

    // Second pass: check for export statements
    const checkExports = (node: ts.Node) => {
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          const exportedName = element.name.text;
          if (valueObjectClasses.has(exportedName)) {
            // Check if it's a type-only export
            // The export must be either "export type { ... }" or individual "type" specifier
            const isValidTypeExport = node.isTypeOnly || element.isTypeOnly;
            if (!isValidTypeExport) {
              const { line, character } =
                sourceFile.getLineAndCharacterOfPosition(element.getStart());
              this.issues.push({
                file: sourceFile.fileName,
                line: line + 1,
                column: character + 1,
                message: `ValueObject ${exportedName} should be exported as type only. Use "export type { ${exportedName} }" or "export { type ${exportedName} }"`,
                severity: 'error',
              });
            }
          }
        }
      }
      ts.forEachChild(node, checkExports);
    };
    ts.forEachChild(sourceFile, checkExports);
  }

  private checkClassDeclaration(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
  ) {
    if (!node.name) return;

    const className = node.name.text;
    const extendsBaseValueObject = this.extendsBaseValueObject(node);

    if (extendsBaseValueObject) {
      // Check if it's exported properly
      this.checkExport(node, sourceFile);

      // Check for corresponding Zod schema
      this.checkZodSchema(className, sourceFile);

      // Check naming convention
      this.checkNamingConvention(className, node, sourceFile);

      // Check for proper type parameter usage
      this.checkTypeParameters(node, sourceFile);
    }

    // Check for duplicate BaseValueObject definitions
    if (
      className === 'BaseValueObject' &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
    ) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(),
      );
      if (!sourceFile.fileName.includes('electron/lib/baseValueObject.ts')) {
        this.issues.push({
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
          message:
            'BaseValueObject should only be defined in electron/lib/baseValueObject.ts. Import it instead.',
          severity: 'error',
        });
      }
    }
  }

  private extendsBaseValueObject(node: ts.ClassDeclaration): boolean {
    if (!node.name) return false;

    // Get the symbol of the class
    const symbol = this.checker.getSymbolAtLocation(node.name);
    if (!symbol) return false;

    // Get the type of the class
    const type = this.checker.getTypeOfSymbolAtLocation(symbol, node);
    if (!type) return false;

    // Check if this type extends BaseValueObject
    return this.isBaseValueObjectType(type);
  }

  private isBaseValueObjectType(type: ts.Type): boolean {
    // Check cache first
    const cached = this.resolvedTypes.get(type);
    if (cached !== undefined) {
      return cached;
    }

    // Get the symbol of the type
    const symbol = type.getSymbol();

    // Check if this is BaseValueObject itself
    if (symbol && symbol.name === 'BaseValueObject') {
      this.resolvedTypes.set(type, true);
      return true;
    }

    // If this is a class type, check its base types
    if (type.isClass()) {
      const baseTypes = this.checker.getBaseTypes(type as ts.InterfaceType);

      // Recursively check each base type
      for (const baseType of baseTypes) {
        if (this.isBaseValueObjectType(baseType)) {
          this.resolvedTypes.set(type, true);
          return true;
        }
      }
    }

    // Also check heritage clauses for direct inheritance check
    // This handles cases where type resolution might miss some inheritance patterns
    if (symbol?.declarations) {
      for (const declaration of symbol.declarations) {
        if (ts.isClassDeclaration(declaration) && declaration.heritageClauses) {
          for (const clause of declaration.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
              for (const heritageType of clause.types) {
                // Get the type of the heritage clause
                const heritageSymbol = this.checker.getSymbolAtLocation(
                  heritageType.expression,
                );
                if (heritageSymbol) {
                  const resolvedType =
                    this.checker.getDeclaredTypeOfSymbol(heritageSymbol);
                  if (
                    resolvedType &&
                    this.isBaseValueObjectType(resolvedType)
                  ) {
                    this.resolvedTypes.set(type, true);
                    return true;
                  }
                }
              }
            }
          }
        }
      }
    }

    // Not a BaseValueObject
    this.resolvedTypes.set(type, false);
    return false;
  }

  private checkTypeParameters(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
  ) {
    if (!node.heritageClauses) return;

    const className = node.name?.text || '';

    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of clause.types) {
          if (type.typeArguments && type.typeArguments.length >= 2) {
            const firstTypeArg = type.typeArguments[0];
            // Check if first type parameter is a string literal matching the class name
            if (
              ts.isLiteralTypeNode(firstTypeArg) &&
              ts.isStringLiteral(firstTypeArg.literal)
            ) {
              const brandType = firstTypeArg.literal.text;
              if (brandType !== className) {
                const { line, character } =
                  sourceFile.getLineAndCharacterOfPosition(
                    firstTypeArg.getStart(),
                  );
                this.issues.push({
                  file: sourceFile.fileName,
                  line: line + 1,
                  column: character + 1,
                  message: `Brand type '${brandType}' should match class name '${className}'`,
                  severity: 'warning',
                });
              }
            }
          } else if (className.includes('PathObject')) {
            // PathObject subclasses have their own opaque symbol
            const hasOpaqueSymbol = node.members.some((member) => {
              if (ts.isPropertyDeclaration(member)) {
                const name = member.name?.getText();
                return name?.includes('opaqueSymbol');
              }
              return false;
            });

            if (!hasOpaqueSymbol) {
              const { line, character } =
                sourceFile.getLineAndCharacterOfPosition(node.getStart());
              this.issues.push({
                file: sourceFile.fileName,
                line: line + 1,
                column: character + 1,
                message: `PathObject subclass ${className} should have its own opaque symbol property`,
                severity: 'warning',
              });
            }
          }
        }
      }
    }
  }

  private checkExport(node: ts.ClassDeclaration, sourceFile: ts.SourceFile) {
    const hasExportModifier = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );

    if (hasExportModifier) {
      const className = node.name?.text;

      // BaseValueObject itself needs to be exported as a class since it's the abstract base
      if (className === 'BaseValueObject') {
        return;
      }

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(),
      );
      this.issues.push({
        file: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
        message: `ValueObject ${className} should be exported as type only, not as class`,
        severity: 'error',
      });
    }
  }

  private checkZodSchema(className: string, sourceFile: ts.SourceFile) {
    // BaseValueObject is abstract and doesn't need a Zod schema
    if (className === 'BaseValueObject') {
      return;
    }

    const schemaName = `${className}Schema`;
    let hasSchema = false;

    const visit = (node: ts.Node) => {
      if (ts.isVariableStatement(node)) {
        const declaration = node.declarationList.declarations[0];
        if (
          declaration &&
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === schemaName
        ) {
          hasSchema = true;
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    if (!hasSchema) {
      this.issues.push({
        file: sourceFile.fileName,
        line: 1,
        column: 1,
        message: `Missing Zod schema ${schemaName} for ValueObject ${className}`,
        severity: 'warning',
      });
    }
  }

  private checkNamingConvention(
    className: string,
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
  ) {
    // Check if class name is PascalCase
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(className)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(),
      );
      this.issues.push({
        file: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
        message: `ValueObject class name should be in PascalCase: ${className}`,
        severity: 'warning',
      });
    }
  }
}

async function main() {
  consola.start('Linting ValueObject implementations...');

  // Find all TypeScript files that might contain ValueObjects
  const patterns = [
    'electron/**/*.ts',
    'src/**/*.ts',
    '!electron/**/*.test.ts',
    '!electron/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!node_modules/**/*',
    '!dist/**/*',
    '!main/**/*',
    '!out/**/*',
  ];

  // Add test directory patterns if in test environment
  if (process.env.NODE_ENV === 'test') {
    patterns.unshift('test-valueobjects/**/*.ts');
  }

  const files = await glob(patterns, {
    cwd: process.cwd(),
    absolute: true,
    ignore: ['node_modules/**', 'dist/**', 'main/**', 'out/**'],
  });

  const linter = new ValueObjectLinter(files);
  const issues = linter.lint();

  if (issues.length === 0) {
    console.log(
      '✔ All ValueObject implementations follow the correct pattern!',
    );
    process.exit(0);
  } else {
    consola.error(`Found ${issues.length} issues:`);

    // Output each issue with clickable file path
    for (const issue of issues) {
      const relativePath = path.relative(process.cwd(), issue.file);
      const icon = issue.severity === 'error' ? '❌' : '⚠️';
      console.log(
        `${icon} ${relativePath}:${issue.line}:${issue.column} - ${issue.message}`,
      );
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    process.exit(errorCount > 0 ? 1 : 0);
  }
}

main().catch((error) => {
  consola.error('Linter failed:', error);
  process.exit(1);
});
