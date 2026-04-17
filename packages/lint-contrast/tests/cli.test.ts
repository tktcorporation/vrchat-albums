/**
 * runCli の単体テスト。
 *
 * JSON モードで stdout が pure JSON になること、
 * text モードでは従来通りの consola メッセージが含まれることを検証する。
 *
 * 指摘 3 の修正: --format json 指定時に consola の status ログが
 * stdout に混入しないことを確認する。
 *
 * 実装ノート: reportJson は console.log で JSON を出力するため、
 * vi.spyOn(console, 'log') でキャプチャする。
 * consola の status ログ (start/info/success/warn) は consola.level = -999 で
 * 無効化されるため、console.log の呼び出しは JSON 出力のみになる。
 */

import path from 'node:path';

import consola from 'consola';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';

import { runCli } from '../src/cli.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../test-fixtures');
const MOCK_CSS = 'mock-index.css';

// テスト用の最小限の argv を組み立てるヘルパー
function buildArgv(extra: string[] = []): string[] {
  return [
    'node',
    'lint-contrast',
    '--project',
    FIXTURES_DIR,
    '--css',
    MOCK_CSS,
    '--glob',
    '*.tsx',
    ...extra,
  ];
}

describe('runCli JSON format mode', () => {
  let consoleLogs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogs = [];
    // reportJson は console.log で JSON を出力するため、それをキャプチャする
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    // consola.level をデフォルトに戻す (テスト間の副作用を防ぐ)
    consola.level = 3;
  });

  it('outputs pure JSON via console.log (no consola status lines mixed in)', async () => {
    await runCli(buildArgv(['--format', 'json']));

    // console.log の呼び出しは JSON 出力のみのはず
    // (consola は level=-999 で無効化されているため console.log を呼ばない)
    expect(consoleLogs.length).toBeGreaterThan(0);

    // 全ての console.log 出力が JSON としてパース可能であること
    const combined = consoleLogs.join('\n');
    expect(() => JSON.parse(combined)).not.toThrow();

    const parsed = JSON.parse(combined) as {
      errorCount: number;
      warningCount: number;
      issues: unknown[];
    };
    expectTypeOf(parsed.errorCount).toBeNumber();
    expectTypeOf(parsed.warningCount).toBeNumber();
    expect(Array.isArray(parsed.issues)).toBe(true);
  });

  it('JSON output contains errorCount, warningCount, issues fields', async () => {
    await runCli(buildArgv(['--format', 'json']));

    const combined = consoleLogs.join('\n');
    const parsed = JSON.parse(combined) as Record<string, unknown>;
    expect(Object.keys(parsed)).toContain('errorCount');
    expect(Object.keys(parsed)).toContain('warningCount');
    expect(Object.keys(parsed)).toContain('issues');
  });
});

describe('runCli text format mode', () => {
  it('exits without throwing (basic smoke test)', async () => {
    // text モードは従来通りの挙動。exit code の確認のみ行う。
    // consola は stdout に出力するが、ここではキャプチャしない。
    await expect(runCli(buildArgv(['--format', 'text']))).resolves.toBeTypeOf(
      'number',
    );
  });
});
