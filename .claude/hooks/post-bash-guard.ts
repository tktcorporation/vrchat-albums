#!/usr/bin/env bun
import { Glob } from 'bun';
import { join } from 'node:path';

// PostToolUse は実行後の通知専用（block できない）なので、pre-bash-guard.ts
// のように最初の非ゼロ終了で打ち切らず、全 project hook を走らせて
// additionalContext をまとめて 1 個の JSON にする。子が複数とも
// additionalContext を返すと JSON が連結されて壊れるため、ここで集約する。
const text = await Bun.stdin.text();
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

async function runCapture(path: string): Promise<string> {
  const interpreter = path.endsWith('.sh') ? 'bash' : 'bun';
  const child = Bun.spawn([interpreter, join(root, path)], {
    cwd: root,
    env: process.env,
    stdin: new Blob([text]),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const out = await new Response(child.stdout).text();
  await child.exited;
  return out.trim();
}

const notes: string[] = [];
for await (const path of new Glob('.claude/hooks/project/post-bash/*.{ts,sh}').scan({
  cwd: root,
})) {
  const out = await runCapture(path);
  if (!out) continue;
  try {
    const parsed = JSON.parse(out);
    const ctx = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof ctx === 'string' && ctx) notes.push(ctx);
  } catch {
    // 子スクリプトの契約は「JSON を1個だけ標準出力に書くか、何も書かない」。
    // それ以外の出力は無視する。
  }
}

if (notes.length > 0)
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: notes.join('\n\n'),
      },
    }),
  );
