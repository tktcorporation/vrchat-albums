#!/usr/bin/env node

/**
 * JSDoc @see Reference Linter
 *
 * Detects @see references to non-existent files in JSDoc comments.
 * Skips URLs and symbol references.
 */

import * as fs from 'node:fs';
import consola from 'consola';
import { glob } from 'glob';
import path from 'pathe';
import {
  type NormalizedPath,
  NormalizedPathArraySchema,
  NormalizedPathSchema,
} from './lib/paths';

export interface JsDocSeeIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  missingPath: string;
}

export interface JsDocSeeLintResult {
  success: boolean;
  issues: JsDocSeeIssue[];
}

export class JsDocSeeLinter {
  private issues: JsDocSeeIssue[] = [];
  private files: NormalizedPath[];
  private projectRoot: NormalizedPath;

  constructor(
    files: string[],
    projectRoot: string,
    private sourceMap?: Map<string, string>,
  ) {
    this.files = NormalizedPathArraySchema.parse(files);
    this.projectRoot = NormalizedPathSchema.parse(projectRoot);
  }

  lint(): JsDocSeeLintResult {
    for (const file of this.files) {
      const content = this.readFile(file);
      if (content !== undefined) {
        this.checkFile(file, content);
      }
    }

    return {
      success: this.issues.length === 0,
      issues: this.issues,
    };
  }

  private readFile(filePath: string): string | undefined {
    if (this.sourceMap) {
      return this.sourceMap.get(filePath);
    }
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  private checkFile(filePath: string, content: string) {
    const lines = content.split('\n');
    const seePattern = /@see\s+([^\s*\n]+)/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      for (const match of line.matchAll(seePattern)) {
        const reference = match[1];
        const column = (match.index ?? 0) + '@see '.length + 1;

        if (this.shouldSkipReference(reference)) {
          continue;
        }

        if (!this.fileExists(reference)) {
          this.issues.push({
            file: filePath,
            line: lineIndex + 1,
            column: column,
            message: `@see reference to non-existent file: ${reference}`,
            severity: 'error',
            missingPath: reference,
          });
        }
      }
    }
  }

  private shouldSkipReference(reference: string): boolean {
    // Skip URLs
    if (reference.startsWith('http://') || reference.startsWith('https://')) {
      return true;
    }

    // Skip JSDoc link syntax
    if (reference.startsWith('{') || reference.endsWith('}')) {
      return true;
    }

    // Skip symbol references (no path separators and no file extensions)
    if (this.isSymbolReference(reference)) {
      return true;
    }

    return false;
  }

  private isSymbolReference(reference: string): boolean {
    if (reference.includes('/') || reference.includes('\\')) {
      return false;
    }

    const fileExtensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.md',
      '.json',
      '.css',
      '.html',
    ];
    for (const ext of fileExtensions) {
      if (reference.endsWith(ext)) {
        return false;
      }
    }

    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(reference);
  }

  private fileExists(reference: string): boolean {
    const resolvedPath = path.resolve(this.projectRoot, reference);

    if (this.sourceMap) {
      return this.sourceMap.has(resolvedPath);
    }

    return fs.existsSync(resolvedPath);
  }
}

export async function lintJsDocSee(
  projectRoot?: string,
): Promise<JsDocSeeLintResult> {
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

  const linter = new JsDocSeeLinter(files, root);
  return linter.lint();
}

const isDirectRun =
  process.argv[1]?.endsWith('lint-jsdoc-see.ts') ||
  process.argv[1]?.endsWith('lint-jsdoc-see.js');

if (isDirectRun) {
  const result = await lintJsDocSee();

  if (result.issues.length > 0) {
    consola.error(
      `Found ${result.issues.length} JSDoc @see reference issue(s):\n`,
    );

    for (const issue of result.issues) {
      const location = `${issue.file}:${issue.line}:${issue.column}`;
      consola.error(`  ${location}: ${issue.severity}: ${issue.message}`);
    }

    process.exit(1);
  }

  consola.success('No JSDoc @see reference issues found.');
  process.exit(0);
}
