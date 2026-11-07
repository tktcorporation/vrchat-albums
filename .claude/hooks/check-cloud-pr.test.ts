import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeGitHubCheckout, git as gitIn, neutralEnv } from './fake-github-checkout.ts';
import type { FakeGitHubCheckout } from './fake-github-checkout.ts';

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
    // 取得先をローカルのパスへ書き換え、origin の照合より後の判定がリモートに問い合わせる前に止まるようにする。
    git(dir, 'config', `url.${join(dir, 'nowhere.git')}.insteadOf`, originUrl);
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
    // origin の照合は通り、その後の取得先の書き換えの確認で、リモートに問い合わせる前に止まる。
    expect(verdict.decision).toBe('deny');
    expect(verdict.reason).toContain('insteadOf');
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

describe('check-cloud-pr.ts の base の判定', () => {
  const CASE_TIMEOUT_MS = 30_000;
  let root = '';
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'check-cloud-pr-stack-'));
  });
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  /**
   * origin の stack が main に無いコミットを指し、feature をその上に積んだ構成。最終ラウンドを
   * default branch（origin/main）に対する証拠付きで記録し、feature を push する。
   */
  async function stackedReviewedCheckout(): Promise<FakeGitHubCheckout & { stackSha: string }> {
    const repo = await fakeGitHubCheckout(root);
    gitIn(repo.cwd, 'push', '-q', repo.bare, 'feature:refs/heads/stack');
    const stackSha = repo.sha;
    await writeFile(join(repo.cwd, 'stacked'), 'stacked');
    gitIn(repo.cwd, 'add', 'stacked');
    gitIn(repo.cwd, 'commit', '-qm', 'stacked');
    const report = join(repo.cwd, '.git', 'final-review.txt');
    await writeFile(report, 'no findings\n');
    const record = (...args: string[]) => {
      const result = Bun.spawnSync(
        ['bun', join(import.meta.dir, 'record-pr-review.ts'), ...args],
        { cwd: repo.cwd, env: { ...neutralEnv(), ...repo.env }, stdout: 'pipe', stderr: 'pipe' },
      );
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    };
    record('1');
    record('0', 'codex', '--base', 'origin/main', '--evidence', report);
    gitIn(repo.cwd, 'push', '-q', repo.bare, 'feature');
    return { ...repo, sha: gitIn(repo.cwd, 'rev-parse', 'HEAD'), stackSha };
  }

  function check(repo: FakeGitHubCheckout, base: string, expectedBase: string) {
    const payload = {
      request: {
        repository_full_name: 'owner/repo',
        head: 'feature',
        base,
        title: 't',
        body: 'b',
        draft: true,
      },
      expectedHead: repo.sha,
      expectedBase,
    };
    const result = Bun.spawnSync(['bun', script], {
      cwd: repo.cwd,
      env: { ...neutralEnv(), ...repo.env },
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return JSON.parse(result.stdout.toString()) as { decision: string; reason?: string };
  }

  test(
    '積み重ねた PR の base を受け付け、証拠は default branch に対するもので照合する',
    async () => {
      const repo = await stackedReviewedCheckout();
      expect(check(repo, 'stack', repo.stackSha)).toEqual(
        expect.objectContaining({ decision: 'allow' }),
      );
      // コネクタへ渡す base の SHA が、判定したリモートの base と違えば止める。
      expect(check(repo, 'stack', 'c'.repeat(40))).toEqual({
        schemaVersion: 1,
        decision: 'deny',
        reason: 'Remote base changed or could not be read',
      });
    },
    CASE_TIMEOUT_MS,
  );

  test(
    'default branch の先端の祖先になっている base は止める',
    async () => {
      const repo = await stackedReviewedCheckout();
      gitIn(repo.cwd, 'push', '-q', repo.bare, 'main:refs/heads/release');
      const mainSha = gitIn(repo.cwd, 'rev-parse', 'main');
      const verdict = check(repo, 'release', mainSha);
      expect(verdict.decision).toBe('deny');
      expect(verdict.reason).toContain('default branch（main）に無いコミットを持たない');
    },
    CASE_TIMEOUT_MS,
  );
});
