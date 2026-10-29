/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const codexAdapter = join(import.meta.dir, '../../.codex/run-shared-hook.ts');
const cursorAdapter = join(import.meta.dir, '../../.cursor/run-shared-hook.ts');

/** 本物と同じファイル名の hook（既定は常に exit 1 で落ちる）をアダプター経由で動かす。 */
async function runStubHook(
  hookName: string,
  payload: Record<string, unknown> | string,
  adapter = codexAdapter,
  hookSource = 'process.exit(1);\n',
): Promise<{ code: number; stdout: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'run-shared-hook-'));
  try {
    const hook = join(dir, hookName);
    await writeFile(hook, hookSource);
    const input =
      typeof payload === 'string'
        ? payload
        : JSON.stringify({ cwd: dir, hook_event_name: 'PreToolUse', ...payload });
    const child = Bun.spawn(['bun', adapter, hook], {
      cwd: dir,
      stdin: new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 1 件ごとにアダプターと hook の 2 プロセスを起動する。Bun の版や実行環境によっては起動が遅く、
// 既定の 5 秒に収まらないため、起動は並列にし、上限も明示する。
const SPAWN_TEST_TIMEOUT_MS = 30_000;

describe('アダプター経由で hook が落ちたとき・入出力を読めないとき', () => {
  test(
    'Codex のアダプターで、全コマンドで動く pre-bash-guard.ts は、警告を出して元の実行を続ける',
    async () => {
      // 解析用の依存を入れられない環境では毎回落ちるため、拒否に倒すと全コマンドが止まり続ける。
      const commands = ['ls -la', 'git status', 'pnpm install'];
      const results = await Promise.all(
        commands.map((cmd) =>
          runStubHook('pre-bash-guard.ts', {
            tool_name: 'exec_command',
            tool_input: { cmd },
          }),
        ),
      );
      for (const result of results) {
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('shared hook failed');
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  // 想定外の形のシェル入力: 文字列の tool_input、cmd の無い入力、cmd と command の食い違い、
  // 文字列でない workdir、command の無い Bash。
  const invalidShellInputs: Record<string, unknown>[] = [
    { tool_name: 'exec_command', tool_input: JSON.stringify({ cmd: 'ls' }) },
    { tool_name: 'exec_command', tool_input: { command: ['ls'] } },
    { tool_name: 'exec_command', tool_input: { cmd: 'ls', command: 'gh pr create' } },
    { tool_name: 'exec_command', tool_input: { cmd: 'ls', workdir: 1 } },
    { tool_name: 'Bash', tool_input: { cmd: 'gh pr create' } },
  ];

  test(
    'Codex のアダプターで、想定外の形のシェル入力は、シェルのガードを経ずに通さず止める',
    async () => {
      // hook は成功する。止まるのは hook を実行する前に、アダプターが入力を拒否したため。
      const results = await Promise.all(
        invalidShellInputs.map((payload) =>
          runStubHook('pre-bash-guard.ts', payload, codexAdapter, 'process.exit(0);\n'),
        ),
      );
      expect(results.map((result) => result.code)).toEqual(invalidShellInputs.map(() => 2));
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'Codex のアダプターで、想定外の形のシェル入力は、ガード以外の hook を実行せずに元の実行を続ける',
    async () => {
      const results = await Promise.all(
        invalidShellInputs.map((payload) => runStubHook('pre-bash-timing.ts', payload)),
      );
      expect(results.map((result) => result.code)).toEqual(invalidShellInputs.map(() => 0));
      // 落ちる hook を実行していれば失敗の診断が出る。出ないことで、実行せずに続けたと分かる。
      for (const result of results) expect(result.stdout).not.toContain('shared hook failed');
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'Codex のアダプターで、入力を読めない PR 作成ゲートとシェルのガードは止める',
    async () => {
      const results = await Promise.all(
        ['require-pr-self-review-mcp.ts', 'pre-bash-guard.ts'].flatMap((hook) =>
          ['{not json', 'null'].map((payload) =>
            runStubHook(hook, payload, codexAdapter, 'process.exit(0);\n'),
          ),
        ),
      );
      expect(results.map((result) => result.code)).toEqual([2, 2, 2, 2]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'Codex のアダプターで、MCP 経由の PR 作成ゲートは、落ちたときも作成を通さない',
    async () => {
      const result = await runStubHook('require-pr-self-review-mcp.ts', {
        tool_name: 'mcp__github__create_pull_request',
        tool_input: { owner: 'owner', repo: 'repo', head: 'feature', base: 'main' },
      });
      expect(result.code).toBe(2);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'Cursor のアダプターでも、PR 作成ゲートが落ちたら作成を拒否する',
    async () => {
      const result = await runStubHook(
        'require-pr-self-review-mcp.ts',
        {
          hook_event_name: 'preToolUse',
          tool_name: 'mcp__github__create_pull_request',
          tool_input: { owner: 'owner', repo: 'repo', head: 'feature', base: 'main' },
        },
        cursorAdapter,
      );
      expect(result.code).toBe(2);
      expect(result.stdout).toContain('"permission":"deny"');
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'Cursor のアダプターでも、PR 作成ゲート以外の hook が落ちたときは警告して通す',
    async () => {
      const result = await runStubHook(
        'pre-bash-guard.ts',
        { hook_event_name: 'beforeShellExecution', command: 'ls -la' },
        cursorAdapter,
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('shared hook failed');
      expect(result.stdout).not.toContain('"permission":"deny"');
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'Cursor のアダプターでも、入力や出力を読めない PR 作成ゲートは作成を拒否する',
    async () => {
      const prInput = {
        hook_event_name: 'preToolUse',
        tool_name: 'mcp__github__create_pull_request',
        tool_input: { owner: 'owner', repo: 'repo', head: 'feature', base: 'main' },
      };
      const results = await Promise.all([
        runStubHook('require-pr-self-review-mcp.ts', '{not json', cursorAdapter),
        runStubHook('require-pr-self-review-mcp.ts', 'null', cursorAdapter),
        ...["console.log('not json');\n", "console.log('[]');\n", "console.log('{}');\n"].map(
          (source) => runStubHook('require-pr-self-review-mcp.ts', prInput, cursorAdapter, source),
        ),
      ]);
      for (const result of results) {
        expect(result.code).toBe(2);
        expect(result.stdout).toContain('"permission":"deny"');
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test('Cursor の設定で、PR 作成ゲートだけを、起動できない・時間切れのときも拒否に倒す', async () => {
    // アダプターが動く前に bun の起動失敗やタイムアウトが起きると、Cursor は既定で操作を通す。
    const config: { hooks: Record<string, { command: string; failClosed?: boolean }[]> } =
      JSON.parse(await readFile(join(import.meta.dir, '../../.cursor/hooks.json'), 'utf8'));
    const entries = Object.values(config.hooks).flat();
    const failClosed = entries.filter((entry) => entry.failClosed === true);
    expect(failClosed.map((entry) => entry.command)).toEqual([
      'bun .cursor/run-shared-hook.ts .claude/hooks/require-pr-self-review-mcp.ts',
    ]);
  });

  test('Claude Code の設定で、PR 作成ゲートだけを、起動できない・時間切れのときも拒否に倒す', async () => {
    // onFailure が無いと、Claude Code も起動失敗やタイムアウトを許可扱いにして操作を通す。
    const settings: {
      hooks: Record<string, { hooks: { command: string; onFailure?: string }[] }[]>;
    } = JSON.parse(await readFile(join(import.meta.dir, '../settings.json'), 'utf8'));
    const entries = Object.values(settings.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks),
    );
    expect(
      entries
        .filter((entry) => entry.onFailure !== undefined)
        .map((entry) => [entry.command, entry.onFailure]),
    ).toEqual([
      [
        'bun "$CLAUDE_PROJECT_DIR"/.claude/hooks/run-or-skip-for-cursor.ts .claude/hooks/require-pr-self-review-mcp.ts',
        'block',
      ],
    ]);
  });

  test(
    'Cursor のアダプターで、PR 作成ゲートが何も出さずに通したときは、許可を明示して返す',
    async () => {
      const result = await runStubHook(
        'require-pr-self-review-mcp.ts',
        {
          hook_event_name: 'preToolUse',
          tool_name: 'mcp__github__create_pull_request',
          tool_input: { owner: 'owner', repo: 'repo', head: 'feature', base: 'main' },
        },
        cursorAdapter,
        'process.exit(0);\n',
      );
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ permission: 'allow' });
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
