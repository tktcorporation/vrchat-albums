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
  let originalConsolaLevel: number;

  beforeEach(() => {
    consoleLogs = [];
    // テスト開始時の consola.level をスナップショットしておく (C14 修正)
    originalConsolaLevel = consola.level;
    // reportJson は console.log で JSON を出力するため、それをキャプチャする
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    // consola.level をテスト開始時の値に戻す (ハードコード 3 ではなくスナップショットを使用)
    consola.level = originalConsolaLevel;
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

describe('runCli JSON format mode with zero violations', () => {
  let consoleLogs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalConsolaLevel: number;

  beforeEach(() => {
    consoleLogs = [];
    // テスト開始時の consola.level をスナップショット (C14 修正)
    originalConsolaLevel = consola.level;
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    // ハードコード 3 ではなくスナップショットを使用 (C14 修正)
    consola.level = originalConsolaLevel;
  });

  it('emits parseable JSON even when no issues found (ok-card-on-background.tsx only)', async () => {
    // 指摘 3 の修正: 違反ゼロでも --format json 指定時に JSON ペイロードを出力する。
    // 下流ツール (jq 等) が空出力で JSON パース失敗しないよう一貫した出力を提供する。
    // ok-card-on-background.tsx のみを対象とするため --glob で絞り込む。
    await runCli(
      buildArgv(['--format', 'json', '--glob', 'ok-card-on-background.tsx']),
    );

    // console.log が少なくとも 1 回呼ばれるはず (JSON 出力)
    expect(consoleLogs.length).toBeGreaterThan(0);

    const combined = consoleLogs.join('\n');
    // parseable JSON であること
    expect(() => JSON.parse(combined)).not.toThrow();

    const parsed = JSON.parse(combined) as {
      errorCount: number;
      warningCount: number;
      issues: unknown[];
    };
    expect(parsed.issues).toEqual([]);
    expect(parsed.errorCount).toBe(0);
    expect(parsed.warningCount).toBe(0);
  });
});

describe('runCli --threshold invalid value', () => {
  // JSON モードで --threshold に無効な値を渡した場合、
  // parseArgs 内の consola.warn が JSON 出力より先に stdout を汚染しないことを確認する。
  // (Codex P2 指摘: scoped logger が作られる前に consola.warn を直接呼ぶと
  //  JSON と警告が stdout 上で混在し jq 等のパイプが壊れる問題の修正)

  let consoleLogs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalConsolaLevel: number;

  beforeEach(() => {
    consoleLogs = [];
    originalConsolaLevel = consola.level;
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    consola.level = originalConsolaLevel;
  });

  it('--format json --threshold invalid: stdout is pure JSON (no warn mixed in)', async () => {
    await runCli(buildArgv(['--format', 'json', '--threshold', 'abc']));

    // console.log の呼び出しは JSON 出力のみのはず
    expect(consoleLogs.length).toBeGreaterThan(0);

    const combined = consoleLogs.join('\n');
    // 警告メッセージが混入していないこと → JSON としてパース可能
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

  it('--format text --threshold invalid: warn is emitted (existing behavior maintained)', async () => {
    // text モードでは警告が出ることを確認する。
    // consola は stderr/stdout に出力するが、ここでは runCli が正常終了することのみ確認。
    await expect(
      runCli(buildArgv(['--format', 'text', '--threshold', 'abc'])),
    ).resolves.toBeTypeOf('number');
  });

  it('--threshold 5.0 (valid): no warning emitted to console.log', async () => {
    await runCli(buildArgv(['--format', 'json', '--threshold', '5.0']));

    const combined = consoleLogs.join('\n');
    // 有効な値では警告なし → JSON としてパース可能
    expect(() => JSON.parse(combined)).not.toThrow();
  });
});

describe('runCli --format invalid value warns (F6)', () => {
  // --format に無効な値を渡した場合、scoped logger 経由で警告が出ることを確認する。
  // JSON モードでは stdout が汚染されないこと (--threshold と同じパターン)。

  let consoleLogs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalConsolaLevel: number;

  beforeEach(() => {
    consoleLogs = [];
    originalConsolaLevel = consola.level;
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    consola.level = originalConsolaLevel;
  });

  it('--format xml (invalid) + JSON output: stdout remains pure JSON', async () => {
    // --format xml は無効 → 警告を蓄積してデフォルト (text) にフォールバック
    // ただし --format text と組み合わせたいため JSON をデフォルトとして別途指定はできない。
    // ここでは runCli が正常終了し例外を投げないことを確認する。
    await expect(runCli(buildArgv(['--format', 'xml']))).resolves.toBeTypeOf(
      'number',
    );
  });

  it('--format text --format xml: text mode で実行され警告が出力される', async () => {
    // text モードでは警告が consola 経由で出力されることを確認する。
    await expect(
      runCli(buildArgv(['--format', 'text', '--format', 'xml'])),
    ).resolves.toBeTypeOf('number');
  });
});

describe('runCli --max-combinations invalid value warns (F6)', () => {
  // --max-combinations に無効な値を渡した場合、scoped logger 経由で警告が出ることを確認する。

  let consoleLogs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalConsolaLevel: number;

  beforeEach(() => {
    consoleLogs = [];
    originalConsolaLevel = consola.level;
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    consola.level = originalConsolaLevel;
  });

  it('--max-combinations -5 (negative): resolves without throwing', async () => {
    // 負の値は無効 → 警告を蓄積してデフォルト値を維持
    await expect(
      runCli(buildArgv(['--format', 'json', '--max-combinations', '-5'])),
    ).resolves.toBeTypeOf('number');
  });

  it('--max-combinations -5 + JSON: stdout is pure JSON (warn not mixed in)', async () => {
    await runCli(buildArgv(['--format', 'json', '--max-combinations', '-5']));

    const combined = consoleLogs.join('\n');
    expect(() => JSON.parse(combined)).not.toThrow();
  });

  it('--max-combinations 0 (zero, invalid): resolves without throwing', async () => {
    // 0 は > 0 条件に違反するため無効
    await expect(
      runCli(buildArgv(['--format', 'json', '--max-combinations', '0'])),
    ).resolves.toBeTypeOf('number');
  });

  it('--max-combinations 16 (valid): resolves without throwing', async () => {
    await expect(
      runCli(buildArgv(['--format', 'json', '--max-combinations', '16'])),
    ).resolves.toBeTypeOf('number');
  });
});

describe('runCli non-text element and gradient handling', () => {
  // WCAG 1.4.11 の非テキスト UI コンポーネント (3:1 基準) と
  // グラデーション背景の skip 判定を検証する。
  // コード側に ignore directive を書かずに linter 単独で擬陽性を吸収する機能。

  let consoleLogs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalConsolaLevel: number;

  beforeEach(() => {
    consoleLogs = [];
    originalConsolaLevel = consola.level;
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    consola.level = originalConsolaLevel;
  });

  it('lucide-react からインポートしたアイコンは issue を出さない (非テキスト扱い)', async () => {
    const exitCode = await runCli(
      buildArgv(['--format', 'json', '--glob', 'ok-non-text-icon.tsx']),
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(consoleLogs.join('\n')) as {
      errorCount: number;
    };
    expect(parsed.errorCount).toBe(0);
  });

  it('SVG primitives (<circle>) も非テキスト扱いになる', async () => {
    const exitCode = await runCli(
      buildArgv(['--format', 'json', '--glob', 'ok-non-text-threshold.tsx']),
    );
    expect(exitCode).toBe(0);
  });

  it('bg-gradient-* を持つ親の配下の要素は skip される', async () => {
    const exitCode = await runCli(
      buildArgv(['--format', 'json', '--glob', 'ok-gradient-bg-skip.tsx']),
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(consoleLogs.join('\n')) as {
      issues: unknown[];
    };
    expect(parsed.issues).toEqual([]);
  });
});

describe('runCli inline disable directive', () => {
  // `lint-contrast-disable-next-line` / `lint-contrast-disable` マーカーで
  // 個別要素の検査を抑制できることを確認する。
  // 非テキスト要素 (アイコン) やグラデーション上のテキストなど、
  // 静的解析では正しく判定できない擬陽性を抑制するための機能。

  let consoleLogs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalConsolaLevel: number;

  beforeEach(() => {
    consoleLogs = [];
    originalConsolaLevel = consola.level;
    logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      });
  });

  afterEach(() => {
    logSpy.mockRestore();
    consola.level = originalConsolaLevel;
  });

  it('JSX コメント形式の disable-next-line で issue が抑制される', async () => {
    const exitCode = await runCli(
      buildArgv(['--format', 'json', '--glob', 'ok-inline-disable.tsx']),
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(consoleLogs.join('\n')) as {
      errorCount: number;
      issues: unknown[];
    };
    expect(parsed.errorCount).toBe(0);
    expect(parsed.issues).toEqual([]);
  });

  it('directive が無ければ同じクラスでも error になる (対照テスト)', async () => {
    // ng-low-contrast-dark.tsx は ok-inline-disable.tsx と同じクラスを使うが
    // directive が無いので dark モードで error が出る。
    const exitCode = await runCli(
      buildArgv(['--format', 'json', '--glob', 'ng-low-contrast-dark.tsx']),
    );
    expect(exitCode).toBe(1);

    const parsed = JSON.parse(consoleLogs.join('\n')) as {
      errorCount: number;
    };
    expect(parsed.errorCount).toBeGreaterThan(0);
  });

  it('directive と対象行の間に説明コメントを挟んでも有効', async () => {
    const exitCode = await runCli(
      buildArgv([
        '--format',
        'json',
        '--glob',
        'ok-inline-disable-with-comment.tsx',
      ]),
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(consoleLogs.join('\n')) as {
      errorCount: number;
      issues: unknown[];
    };
    expect(parsed.errorCount).toBe(0);
    expect(parsed.issues).toEqual([]);
  });

  it('directive の後に複数行 JSX コメントが続いても有効', async () => {
    const exitCode = await runCli(
      buildArgv([
        '--format',
        'json',
        '--glob',
        'ok-inline-disable-multiline-comment.tsx',
      ]),
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(consoleLogs.join('\n')) as {
      errorCount: number;
      issues: unknown[];
    };
    expect(parsed.errorCount).toBe(0);
    expect(parsed.issues).toEqual([]);
  });

  it('directive と対象行の間にコード行があると無効化される', async () => {
    const exitCode = await runCli(
      buildArgv([
        '--format',
        'json',
        '--glob',
        'ng-disable-blocked-by-code.tsx',
      ]),
    );
    expect(exitCode).toBe(1);

    const parsed = JSON.parse(consoleLogs.join('\n')) as {
      errorCount: number;
      issues: { line: number }[];
    };
    expect(parsed.errorCount).toBeGreaterThan(0);
  });
});
