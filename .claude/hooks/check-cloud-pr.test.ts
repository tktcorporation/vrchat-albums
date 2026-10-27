import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'check-cloud-pr.ts');
const ORIGIN_ERROR = 'origin is not the GitHub.com repository the connector creates the PR in';

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
}

/** origin だけを差し替えた、head ブランチをチェックアウトした作業ツリーで事前チェックを走らせる。 */
function preflight(
  originUrl: string,
  extraOriginUrls: string[] = [],
): {
  schemaVersion?: number;
  decision: string;
  reason?: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'check-cloud-pr-'));
  try {
    git(dir, 'init', '-q', '-b', 'feat');
    git(
      dir,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'x',
    );
    git(dir, 'remote', 'add', 'origin', originUrl);
    for (const url of extraOriginUrls) git(dir, 'config', '--add', 'remote.origin.url', url);
    const payload = {
      request: {
        repository_full_name: 'acme/repo',
        head: 'feat',
        base: 'main',
        title: 't',
        body: 'b',
        draft: true,
      },
      expectedHead: 'a'.repeat(40),
      expectedBase: 'b'.repeat(40),
    };
    const result = Bun.spawnSync(['bun', script], {
      cwd: dir,
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return JSON.parse(result.stdout.toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-cloud-pr.ts の origin の照合', () => {
  test('github.com 以外のホストにある同名リポジトリの origin は拒否する', () => {
    const verdict = preflight('https://ghe.example.com/acme/repo.git');
    expect(verdict).toEqual({ schemaVersion: 1, decision: 'deny', reason: ORIGIN_ERROR });
  });

  test.each([
    'https://github.com/acme/repo.git',
    'git@github.com:acme/repo.git',
    'ssh://git@ssh.github.com:443/acme/repo.git',
  ])('github.com の同じリポジトリ（%s）は origin の照合を通る', (url) => {
    const verdict = preflight(url);
    // 後段（origin/HEAD の無い base の確認など）で止まるが、origin の照合では止まらない。
    expect(verdict.decision).toBe('deny');
    expect(verdict.reason).not.toBe(ORIGIN_ERROR);
  });

  test('origin の URL が複数あれば、どれも github.com の同じリポジトリでも拒否する', () => {
    const verdict = preflight('https://github.com/acme/repo.git', ['git@github.com:acme/repo.git']);
    expect(verdict.reason).toBe(ORIGIN_ERROR);
  });

  test('github.com でも別のリポジトリの origin は拒否する', () => {
    const verdict = preflight('https://github.com/acme/other.git');
    expect(verdict.reason).toBe(ORIGIN_ERROR);
  });
});
