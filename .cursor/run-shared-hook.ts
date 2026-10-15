#!/usr/bin/env bun
/**
 * Cursor → shared `.claude/hooks` adapter.
 *
 * Cursor の hook 入力を Claude Code と同じ形に揃え、共有 hook を実行し、
 * 出力を Cursor が読める形へ戻す。Codex の `.codex/run-shared-hook.ts` と同役割。
 *
 * CURSOR_HOOK_VIA_ADAPTER=1 を立てるので、Claude settings.json 経由の
 * 二重実行スキップ（run-or-skip-for-cursor.ts）に吸われない。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { projectDirectory, workingTree } from '../.claude/hooks/hook-utils.ts';

const args = process.argv.slice(2);
let eventOverride: string | undefined;
const hookArgs: string[] = [];
for (const arg of args) {
  if (arg.startsWith('--event=')) eventOverride = arg.slice('--event='.length);
  else hookArgs.push(arg);
}
const hookPath = hookArgs[0];
if (!hookPath) throw new Error('shared hook path is required');

process.env.CLAUDE_PROJECT_DIR = await projectDirectory();
process.env.CURSOR_HOOK_VIA_ADAPTER = '1';
const tree = await workingTree();
const inputText = await Bun.stdin.text();

interface CursorHookInput {
  conversation_id?: string;
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  workspace_roots?: string[];
  prompt?: string;
  user_prompt?: string;
  command?: string;
  file_path?: string;
  tool_name?: string;
  tool_input?: string | Record<string, unknown>;
  tool_output?: string;
  tool_response?: Record<string, unknown>;
  duration?: number;
  loop_count?: number;
  cursor_version?: string;
  [key: string]: unknown;
}

interface ClaudePayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  prompt?: string;
  user_prompt?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let cursorInput: CursorHookInput;
try {
  const parsed: CursorHookInput = JSON.parse(inputText);
  cursorInput = parsed;
} catch {
  process.exit(0);
}

const EVENT_MAP: Record<string, string> = {
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  beforeSubmitPrompt: 'UserPromptSubmit',
  stop: 'Stop',
  beforeShellExecution: 'PreToolUse',
  afterShellExecution: 'PostToolUse',
  afterFileEdit: 'PostToolUse',
};

function asToolInput(value: CursorHookInput['tool_input']): Record<string, unknown> {
  if (isRecord(value)) return { ...value };
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return { ...parsed };
    } catch {
      return { command: value };
    }
  }
  return {};
}

function toClaudePayload(input: CursorHookInput): ClaudePayload {
  const hookEvent =
    eventOverride ??
    EVENT_MAP[input.hook_event_name ?? ''] ??
    input.hook_event_name ??
    'PreToolUse';
  const toolInput = asToolInput(input.tool_input);
  if (input.command && toolInput.command === undefined) toolInput.command = input.command;
  if (input.file_path && toolInput.file_path === undefined) toolInput.file_path = input.file_path;
  if (toolInput.path && toolInput.file_path === undefined) toolInput.file_path = toolInput.path;

  const toolResponse: Record<string, unknown> = {
    ...input.tool_response,
  };
  if (input.duration !== undefined && toolResponse.duration_ms === undefined)
    toolResponse.duration_ms = input.duration;
  if (typeof input.tool_output === 'string' && toolResponse.exit_code === undefined) {
    try {
      const parsed: unknown = JSON.parse(input.tool_output);
      if (isRecord(parsed)) {
        if (parsed.exitCode !== undefined) toolResponse.exit_code = parsed.exitCode;
        if (parsed.exit_code !== undefined) toolResponse.exit_code = parsed.exit_code;
      }
    } catch {
      // tool_output が JSON でなければ終了コードは不明のまま
    }
  }

  return {
    session_id: input.conversation_id ?? input.session_id,
    hook_event_name: hookEvent,
    cwd: input.cwd ?? input.workspace_roots?.[0] ?? tree,
    prompt: input.prompt,
    user_prompt: input.user_prompt ?? input.prompt,
    tool_input: toolInput,
    tool_response: Object.keys(toolResponse).length > 0 ? toolResponse : undefined,
    stop_hook_active: typeof input.loop_count === 'number' ? input.loop_count > 0 : undefined,
  };
}

/** Cursor に返す、意図しない hook 失敗の診断。exit 2 以外は実行を止めない。 */
function unexpectedFailure(status: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 4_000);
  const lines = [
    `⚠️ shared hook failed: \`${hookPath}\` (exit ${status})。`,
    'この失敗は明示的なブロックではないため、元のツール実行は継続した。hook の修正が必要か確認すること。',
  ];
  if (detail) lines.push(`stderr:\n${detail}`);
  return JSON.stringify({
    additional_context: lines.join('\n'),
    hookSpecificOutput: {
      hookEventName: EVENT_MAP[cursorInput.hook_event_name ?? ''] ?? 'PreToolUse',
      additionalContext: lines.join('\n'),
    },
  });
}

function toCursorOutput(output: string): string {
  if (!output) return '';
  try {
    const parsed: unknown = JSON.parse(output);
    if (!isRecord(parsed))
      return unexpectedFailure(1, `hook returned invalid hook protocol JSON:\n${output}`);

    // 既に Cursor ネイティブ形ならそのまま
    if (
      typeof parsed.permission === 'string' ||
      typeof parsed.followup_message === 'string' ||
      typeof parsed.additional_context === 'string' ||
      typeof parsed.continue === 'boolean'
    )
      return output;

    const result: Record<string, unknown> = {};
    const nested = isRecord(parsed.hookSpecificOutput) ? parsed.hookSpecificOutput : undefined;

    if (nested) {
      if (nested.permissionDecision === 'deny') {
        result.permission = 'deny';
        if (typeof nested.permissionDecisionReason === 'string') {
          result.user_message = nested.permissionDecisionReason;
          result.agent_message = nested.permissionDecisionReason;
        }
      } else if (nested.permissionDecision === 'allow') {
        result.permission = 'allow';
      }
      if (nested.updatedInput && typeof nested.updatedInput === 'object')
        result.updated_input = nested.updatedInput;
      if (typeof nested.additionalContext === 'string') {
        result.additional_context = nested.additionalContext;
        // beforeSubmitPrompt 向け: Cursor が Claude 互換を読む場合に備えて残す
        result.continue = true;
        result.hookSpecificOutput = nested;
      }
      if (nested.decision === 'block' && typeof nested.reason === 'string')
        result.followup_message = nested.reason;
    }

    if (parsed.decision === 'block' && typeof parsed.reason === 'string')
      result.followup_message = parsed.reason;

    if (Object.keys(result).length > 0) return JSON.stringify(result);
    // Claude 形式のまま返しても Cursor は hookSpecificOutput を読める
    if (nested) return output;
  } catch {
    // JSON として読めない場合は下の共通診断
  }
  return unexpectedFailure(1, `hook returned invalid hook protocol JSON:\n${output}`);
}

const runHook = async (
  payload: ClaudePayload,
): Promise<{ output: string; status: number; stderr: string }> => {
  const executable = isAbsolute(hookPath) ? hookPath : join(tree, hookPath);
  if (!existsSync(executable) && !isAbsolute(hookPath)) {
    return {
      output: '',
      status: 1,
      stderr: `ENOENT: shared hook not found: ${executable}`,
    };
  }
  const command = hookPath.endsWith('.ts') ? ['bun', executable] : [executable];
  try {
    const processHandle = Bun.spawn(command, {
      cwd: tree,
      env: process.env,
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [output, stderr, status] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]);
    return { output: output.trim(), status, stderr };
  } catch (error) {
    return {
      output: '',
      status: 1,
      stderr: error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  }
};

const payload = toClaudePayload(cursorInput);
const { output, status, stderr } = await runHook(payload);

// exit 2 は明示的な拒否。0 / 2 以外は診断を注入して fail-open。
if (status !== 0 && status !== 2) {
  console.log(unexpectedFailure(status, stderr));
  process.exit(0);
}
if (status === 2) {
  if (stderr) process.stderr.write(stderr);
  // Cursor は exit 2 でも JSON の permission:deny を好むので両方出す
  const reason = stderr.trim() || 'Blocked by shared hook';
  console.log(
    JSON.stringify({
      permission: 'deny',
      user_message: reason,
      agent_message: reason,
    }),
  );
  process.exit(2);
}

const cursorOutput = toCursorOutput(output);
if (cursorOutput) console.log(cursorOutput);
process.exit(0);
