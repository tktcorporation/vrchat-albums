#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { workingTree } from '../.claude/hooks/hook-utils.ts';

const hookPath = process.argv[2];
if (!hookPath) throw new Error('shared hook path is required');
// このアダプターが置かれたプロジェクト。相対パスの hook はここを基準に解く。プロセスの現在地
// （サブモジュールの中などセッションの作業場所）を基準にすると、そこに無いファイルを指す。
const projectRoot = join(import.meta.dir, '..');
// MCP 経由の PR 作成ゲートは、落ちたときも作成を通さない（対象は PR 作成の呼び出しだけ）。
// 全コマンドで動く pre-bash-guard.ts は対象にしない。落ちたときに拒否へ倒すと、解析用の依存を
// 入れられない環境（オフライン、依存の lockfile を読めない古い Bun）で全コマンドが止まり続ける。
const isPrGate = basename(hookPath) === 'require-pr-self-review-mcp.ts';
// シェルのコマンドを検査するガード（Bash の PR 作成ゲートを含む）。落ちたときは上の理由で通すが、
// 入力そのものが壊れているときは止める。検査できない入力のまま通すと、コマンドがガードを経ずに
// 実行される一方、正しい形の入力でやり直せば済むので、止めても作業は続けられる。
const isShellGuard = basename(hookPath) === 'pre-bash-guard.ts';
function refuse(detail: string): never {
  process.stderr.write(`shared hook blocked: ${hookPath}: ${detail}\n`);
  process.exit(2);
}
/**
 * 想定外の入力。PR 作成ゲートとシェルのガードは実行を止め、それ以外の hook は実行せずに元の処理を
 * 続ける。
 */
function invalidInput(detail: string): never {
  if (isPrGate || isShellGuard) refuse(detail);
  process.stderr.write(`shared hook skipped: ${hookPath}: ${detail}\n`);
  process.exit(0);
}
// Claude Code が hook に渡すものと同じ形にする: CLAUDE_PROJECT_DIR は状態ファイル用の
// プロジェクト、入力の cwd は lint / 検証の対象になる作業ツリー（worktree）。
process.env.CLAUDE_PROJECT_DIR = projectRoot;
const tree = await workingTree();
const executable = isAbsolute(hookPath) ? hookPath : join(projectRoot, hookPath);
const inputText = await Bun.stdin.text();
interface HookPayload {
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: string | { file_path?: string; cmd?: string; command?: string; workdir?: string };
  hookSpecificOutput?: { additionalContext?: string };
  [key: string]: unknown;
}
let input: HookPayload;
try {
  const parsed: HookPayload = JSON.parse(inputText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('hook input must be an object');
  }
  input = parsed;
} catch {
  invalidInput('invalid hook input JSON');
}
if (input.tool_name === 'exec_command') {
  const shell = input.tool_input;
  if (!shell || typeof shell !== 'object' || typeof shell.cmd !== 'string') {
    invalidInput('exec_command requires tool_input.cmd');
  }
  if (shell.command !== undefined && shell.command !== shell.cmd) {
    invalidInput('conflicting tool_input.cmd and command');
  }
  if (shell.workdir !== undefined && typeof shell.workdir !== 'string') {
    invalidInput('invalid tool_input.workdir');
  }
  // Host cwd identifies the session; workdir identifies the actual command.
  // Resolve relative paths against the host process, like exec_command does.
  input.cwd = shell.workdir === undefined ? (input.cwd ?? tree) : resolve(shell.workdir);
  input.tool_input = { ...shell, command: shell.cmd };
} else if (input.tool_name === 'Bash') {
  const shell = input.tool_input;
  if (!shell || typeof shell !== 'object' || typeof shell.command !== 'string') {
    invalidInput('Bash requires tool_input.command');
  }
}
input.cwd ??= tree;

// hook が見つからないまま通すと、PreToolUse のガードが黙って外れる。
if (!existsSync(executable)) {
  console.error(`hook が見つかりません: ${executable}`);
  if (input.hook_event_name === 'PreToolUse') process.exit(2);
  console.log(unexpectedFailure(1, `hook が見つかりません: ${executable}`));
  process.exit(0);
}

/** Codex に返す、意図しない hook 失敗の診断。exit 2 以外は実行を止める指示ではない。 */
function unexpectedFailure(status: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 4_000);
  if (isPrGate) refuse(`exit ${status}: ${detail}`);
  const lines = [
    `⚠️ shared hook failed: \`${hookPath}\` (exit ${status})。`,
    'この失敗は明示的なブロックではないため、元のツール実行は継続した。hook の修正が必要か確認すること。',
  ];
  if (detail) lines.push(`stderr:\n${detail}`);
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name ?? 'PreToolUse',
      additionalContext: lines.join('\n'),
    },
  });
}

const runHook = async (payload: unknown): Promise<string> => {
  const command = hookPath.endsWith('.ts') ? ['bun', executable] : [executable];
  let output: string;
  let stderr: string;
  let status: number;
  try {
    const processHandle = Bun.spawn(command, {
      cwd: tree,
      env: process.env,
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    [output, stderr, status] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]);
  } catch (error) {
    return unexpectedFailure(
      1,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
  // exit 2 は pre-bash-guard のような明示的な拒否。ここで 0 にすると安全上の block を
  // すり抜ける。0 / 2 以外は未処理例外・外部コマンド失敗・シグナル終了などの異常終了で、
  // Codex が hook 名も stderr も表示せず「Hook failed」だけを繰り返すので、診断を注入して
  // fail-open にする（PR 作成ゲートだけは unexpectedFailure が拒否する）。
  if (status !== 0 && status !== 2) return unexpectedFailure(status, stderr);
  if (status === 2) {
    if (stderr) process.stderr.write(stderr);
    process.exit(status);
  }
  return output.trim();
};

/** Hook の stdout は Codex hook protocol の JSON だけを許す。 */
function protocolOutput(output: string): string {
  if (!output) return '';
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const hookSpecificOutput =
        'hookSpecificOutput' in parsed ? parsed.hookSpecificOutput : undefined;
      const decision = 'decision' in parsed ? parsed.decision : undefined;
      const reason = 'reason' in parsed ? parsed.reason : undefined;
      if (
        (hookSpecificOutput !== null && typeof hookSpecificOutput === 'object') ||
        (decision === 'block' && typeof reason === 'string')
      )
        return output;
    }
  } catch {
    // JSON として読めない場合も、下の共通診断にする。
  }
  return unexpectedFailure(1, `hook returned invalid hook protocol JSON:\n${output}`);
}

if (typeof input.tool_input !== 'string') {
  const output = protocolOutput(await runHook(input));
  if (output) console.log(output);
  process.exit(0);
}

const files = [
  ...input.tool_input.matchAll(
    /^\*\*\* (?:Add|Update|Delete) File: (.*)$|^\*\*\* Move to: (.*)$/gm,
  ),
]
  .map((match) => match[1] ?? match[2])
  .filter((file, index, all) => all.indexOf(file) === index);
if (files.length === 0) files.push('');

const outputs: HookPayload[] = [];
for (const file of files) {
  const payload = file ? { ...input, tool_input: { file_path: file } } : input;
  const output = protocolOutput(await runHook(payload));
  if (!output) continue;
  outputs.push(JSON.parse(output));
}
if (outputs.length === 1) console.log(JSON.stringify(outputs[0]));
if (outputs.length > 1) {
  const merged = outputs[0];
  const hookOutput = merged.hookSpecificOutput ?? {};
  merged.hookSpecificOutput = hookOutput;
  hookOutput.additionalContext = outputs
    .map((item) => item.hookSpecificOutput?.additionalContext)
    .filter(Boolean)
    .join('\n');
  console.log(JSON.stringify(merged));
}
