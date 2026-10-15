import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { str, time } from './claude-jobs';
import { readJson } from './fs';
import { fail, ok, type SourceResult } from './types';

export type ClaudeSession = {
  pid: number;
  // Claude 2.1.251 より前など、保存済みセッションに無い形式とも互換にする。
  procStart?: string | null;
  sessionId: string;
  kind: 'interactive' | 'bg' | 'unknown';
  name: string | null;
  status: 'busy' | 'idle' | 'unknown';
  cwd: string;
  jobId: string | null;
  startedAt: number | null;
  updatedAt: number | null;
};

export function parseClaudeSession(raw: unknown): ClaudeSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sessionId = str(r.sessionId);
  const cwd = str(r.cwd);
  // pid 0 は process.kill(0, 0) が呼び出し元のプロセスグループ全体を探すため常に
  // 生存扱いになってしまう。負数・非整数もプロセス ID としてありえないので弾く。
  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0 || !sessionId || !cwd) return null;
  const kind = r.kind === 'interactive' || r.kind === 'bg' ? r.kind : 'unknown';
  const status = r.status === 'busy' || r.status === 'idle' ? r.status : 'unknown';
  return {
    pid: r.pid,
    procStart: str(r.procStart),
    sessionId,
    kind,
    name: str(r.name),
    status,
    cwd,
    jobId: str(r.jobId),
    startedAt: time(r.startedAt),
    updatedAt: time(r.updatedAt),
  };
}

// sessions/<pid>.json はプロセス終了後も残るファイルなので、pid の生存で絞り込む。
// EPERM は「別ユーザー所有などで signal は送れないが存在はする」ケースなので生存扱いにする。
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// PID は終了後に OS が別プロセスへ再割り当てることがある。signal 0 だけでは stale な
// sessions/<pid>.json を現行セッションとして復活させてしまうので、ps で Claude CLI
// のプロセスであることも確認する。macOS と Linux のどちらでも使える POSIX `ps` を使い、
// 確認できない環境は安全側（非アクティブ）に倒す。
export function isClaudeProcess(pid: number): boolean {
  if (!isProcessAlive(pid)) return false;
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /(?:^|[\\/\\s])claude(?:-code)?(?:[\\s]|$)/i.test(command);
  } catch {
    return false;
  }
}

// Claude が Linux で保存する procStart は /proc/<pid>/stat の starttime（field 22）。
// PID を別の Claude が再利用してもこの値は一致しない。macOS など procStart を保存しない
// セッションは、後方互換として CLI 名の検証だけを使う。
export function processStartForPid(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterCommand = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return afterCommand[19] ?? null;
  } catch {
    return null;
  }
}

export function isClaudeSessionActive(
  session: ClaudeSession,
  isClaude: (pid: number) => boolean = isClaudeProcess,
  startForPid: (pid: number) => string | null = processStartForPid,
): boolean {
  if (!isClaude(session.pid)) return false;
  return session.procStart == null || startForPid(session.pid) === session.procStart;
}

export const defaultSessionsDir = () => join(homedir(), '.claude', 'sessions');

export async function collectClaudeSessions(
  dir = defaultSessionsDir(),
  // テストや特殊なランナーではこの判定を差し替えられる。既定では PID の存在と Claude CLI
  // であることに加え、Linux では procStart も照合して PID 再利用による誤表示を防ぐ。
  isActive: (session: ClaudeSession) => boolean = isClaudeSessionActive,
): Promise<SourceResult<ClaudeSession[]>> {
  if (!existsSync(dir)) return fail('not_found', dir);
  let names: string[];
  try {
    // dir は existsSync 通過後も、通常ファイルだったり削除されている可能性がある
    // （TOCTOU）。readdirSync の例外はここで分類し、呼び出し元へは投げない。
    names = readdirSync(dir);
  } catch (e) {
    return fail('not_found', `${dir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  const out: ClaudeSession[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const r = readJson(join(dir, name));
    // 1 セッションの json が欠損・破損していても、他の正常なセッション一覧を
    // 止めてはいけないため、そのセッションだけを飛ばして続行する。
    if (!r.ok) continue;
    const s = parseClaudeSession(r.value);
    if (!s || s.kind !== 'interactive' || !isActive(s)) continue;
    out.push(s);
  }
  return ok(out);
}
