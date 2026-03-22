#!/usr/bin/env node

/**
 * Effect TS リンター
 *
 * Effect TS ネイティブ エラーハンドリング設計の品質を担保するリントスクリプト。
 *
 * ルール一覧:
 * - no-neverthrow-import: neverthrow のインポート残存を検出
 * - use-effect-type: サービス層の ResultAsync/Result 残存を検出
 * - no-effect-fail-userfacingerror: Effect.fail(UserFacingError) パターンを検出
 * - no-mock-resolved-effect: mockResolvedValue(Effect.succeed/fail) パターンを検出
 * - no-run-effect-for-trpc: 旧 runEffectForTRPC の使用を検出
 * - require-cause-in-mapError: mapError 内の withStructuredInfo に cause がないケースを警告
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import * as fs from 'node:fs';
import consola from 'consola';
import { glob } from 'glob';
import { NormalizedPathArraySchema, NormalizedPathSchema } from './lib/paths';

interface LintError {
  file: string;
  line: number;
  message: string;
  rule: string;
  severity: 'error' | 'warning';
}

const issues: LintError[] = [];

function addIssue(
  file: string,
  line: number,
  rule: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
) {
  issues.push({ file, line, rule, message, severity });
}

/**
 * neverthrow インポートの残存チェック
 */
function checkNoNeverthrowImports(filePath: string, content: string) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      (line.includes("from 'neverthrow'") ||
        line.includes('from "neverthrow"')) &&
      !line.trimStart().startsWith('//') &&
      !line.trimStart().startsWith('*')
    ) {
      addIssue(
        filePath,
        i + 1,
        'no-neverthrow-import',
        'neverthrow のインポートが残っています。Effect TS に移行してください。',
      );
    }
  }
}

/**
 * サービス層の ResultAsync/Result 残存チェック
 */
function checkServiceReturnsEffect(filePath: string, content: string) {
  if (!filePath.endsWith('service.ts')) return;
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      (line.includes('ResultAsync<') ||
        // Result< にマッチするが PartialSuccessResult 等の部分一致を除外
        /(?<![A-Za-z])Result</.test(line)) &&
      !line.trimStart().startsWith('//') &&
      !line.trimStart().startsWith('*')
    ) {
      addIssue(
        filePath,
        i + 1,
        'use-effect-type',
        'neverthrow の Result/ResultAsync 型が残っています。Effect.Effect<T, E> に置き換えてください。',
      );
    }
  }
}

/**
 * Effect.fail(UserFacingError.withStructuredInfo(...)) パターンの検出
 *
 * 背景: Effect.fail で UserFacingError を E チャネルに入れると、
 * Effect.runPromise が FiberFailure に包んで tRPC の findUserFacingError が発見できない。
 * コントローラー層では Effect.mapError で UserFacingError に変換し、runEffect に渡すべき。
 */
function checkNoEffectFailUserFacingError(filePath: string, content: string) {
  // テストファイルは除外
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes('Effect.fail') &&
      (line.includes('UserFacingError') ||
        line.includes('UserFacingError.withStructuredInfo'))
    ) {
      addIssue(
        filePath,
        i + 1,
        'no-effect-fail-userfacingerror',
        'Effect.fail(UserFacingError) は FiberFailure 問題を引き起こします。Effect.mapError で変換し runEffect に渡してください。',
      );
    }
  }
}

/**
 * mockResolvedValue(Effect.succeed/fail(...)) パターンの検出
 *
 * 背景: Effect を返す関数のモックに mockResolvedValue を使うと
 * Promise<Effect> になり、yield* で展開できずランタイムエラーになる。
 * mockReturnValue を使うべき。
 */
function checkNoMockResolvedEffect(filePath: string, content: string) {
  // テストファイルのみ対象
  if (!filePath.includes('.test.') && !filePath.includes('.spec.')) return;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes('mockResolvedValue') &&
      (line.includes('Effect.succeed') || line.includes('Effect.fail'))
    ) {
      addIssue(
        filePath,
        i + 1,
        'no-mock-resolved-effect',
        'Effect を返す関数には mockReturnValue を使ってください（mockResolvedValue は Promise でラップしてしまいます）。',
      );
    }
  }
}

/**
 * 旧 runEffectForTRPC の使用検出
 */
function checkNoRunEffectForTRPC(filePath: string, content: string) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes('runEffectForTRPC') &&
      !line.trimStart().startsWith('//') &&
      !line.trimStart().startsWith('*')
    ) {
      addIssue(
        filePath,
        i + 1,
        'no-run-effect-for-trpc',
        '旧 runEffectForTRPC は廃止されました。runEffect (effectTRPC.ts) を使用してください。',
      );
    }
  }
}

/**
 * mapError 内の withStructuredInfo に cause がないケースを警告
 *
 * 背景: cause がないと logger.error が Sentry に送信しない。
 * 意図的な省略は // effect-lint-ignore-cause コメントで明示。
 */
function checkCauseInMapError(filePath: string, content: string) {
  // テストファイルは除外
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return;

  const lines = content.split('\n');
  let inMapError = false;
  let mapErrorStartLine = 0;
  let braceDepth = 0;
  let foundWithStructuredInfo = false;
  let foundCause = false;
  let hasIgnoreComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // mapError ブロックの開始を検出
    if (line.includes('Effect.mapError') || line.includes('mapError(')) {
      inMapError = true;
      mapErrorStartLine = i;
      braceDepth = 0;
      foundWithStructuredInfo = false;
      foundCause = false;
      hasIgnoreComment = false;
    }

    if (inMapError) {
      // effect-lint-ignore-cause コメントを検出
      if (line.includes('effect-lint-ignore-cause')) {
        hasIgnoreComment = true;
      }

      // withStructuredInfo の検出
      if (line.includes('withStructuredInfo')) {
        foundWithStructuredInfo = true;
      }

      // cause: の検出
      if (line.includes('cause:') || line.includes('cause :')) {
        foundCause = true;
      }

      // ブレース追跡でブロック終了を検出
      for (const char of line) {
        if (char === '(') braceDepth++;
        if (char === ')') braceDepth--;
      }

      if (braceDepth <= 0 && i > mapErrorStartLine) {
        // mapError ブロック終了
        if (foundWithStructuredInfo && !foundCause && !hasIgnoreComment) {
          addIssue(
            filePath,
            mapErrorStartLine + 1,
            'require-cause-in-mapError',
            'mapError 内の UserFacingError.withStructuredInfo に cause がありません。Sentry に元エラーが送信されません。意図的な省略は // effect-lint-ignore-cause を追加してください。',
            'warning',
          );
        }
        inMapError = false;
      }
    }
  }
}

async function main() {
  const targetPaths = NormalizedPathArraySchema.parse(
    await glob('electron/**/*.ts', {
      ignore: ['**/node_modules/**', '**/*.d.ts'],
    }),
  );

  const srcPaths = NormalizedPathArraySchema.parse(
    await glob('src/**/*.{ts,tsx}', {
      ignore: ['**/node_modules/**', '**/*.d.ts'],
    }),
  );

  const allPaths = [...targetPaths, ...srcPaths];

  for (const filePath of allPaths) {
    const normalizedPath = NormalizedPathSchema.parse(filePath);
    const content = fs.readFileSync(normalizedPath, 'utf-8');

    checkNoNeverthrowImports(normalizedPath, content);
    checkServiceReturnsEffect(normalizedPath, content);
    checkNoEffectFailUserFacingError(normalizedPath, content);
    checkNoMockResolvedEffect(normalizedPath, content);
    checkNoRunEffectForTRPC(normalizedPath, content);
    checkCauseInMapError(normalizedPath, content);
  }

  const errorIssues = issues.filter((i) => i.severity === 'error');
  const warningIssues = issues.filter((i) => i.severity === 'warning');

  if (warningIssues.length > 0) {
    consola.warn(`\n${warningIssues.length} warning(s):\n`);
    for (const issue of warningIssues) {
      consola.warn(`  ${issue.file}:${issue.line}`);
      consola.warn(`    [${issue.rule}] ${issue.message}\n`);
    }
  }

  if (errorIssues.length > 0) {
    consola.error(`\n${errorIssues.length} error(s):\n`);
    for (const issue of errorIssues) {
      consola.error(`  ${issue.file}:${issue.line}`);
      consola.error(`    [${issue.rule}] ${issue.message}\n`);
    }
    process.exit(1);
  }

  consola.success(
    `Effect TS lint passed: ${warningIssues.length} warning(s), 0 error(s).`,
  );
}

main().catch((error) => {
  consola.error('Lint script failed:', error);
  process.exit(1);
});
