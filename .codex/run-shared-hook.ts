#!/usr/bin/env bun
import { isAbsolute, join } from 'node:path';
import { projectDirectory, workingTree } from '../.claude/hooks/hook-utils.ts';

const hookPath = process.argv[2];
if (!hookPath) throw new Error('shared hook path is required');
// Claude Code が hook に渡すものと同じ形にする: CLAUDE_PROJECT_DIR は状態ファイル用の
// 主チェックアウト、入力の cwd は lint / 検証の対象になる作業ツリー（worktree）。
process.env.CLAUDE_PROJECT_DIR = await projectDirectory();
const tree = await workingTree();
const inputText = await Bun.stdin.text();
interface HookPayload {
  cwd?: string;
  hook_event_name?: string;
  tool_input?: string | { file_path?: string };
  hookSpecificOutput?: { additionalContext?: string };
  [key: string]: unknown;
}
let input: HookPayload;
try {
  input = JSON.parse(inputText);
} catch {
  process.exit(0);
}
input.cwd ??= tree;

/** Codex に返す、意図しない hook 失敗の診断。exit 2 以外は実行を止める指示ではない。 */
function unexpectedFailure(status: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 4_000);
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
  const executable = isAbsolute(hookPath) ? hookPath : join(tree, hookPath);
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
  // fail-open にする。
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
