/**
 * テスト用の、origin を GitHub の URL（`ssh://github.com/owner/repo.git`）にしたチェックアウト。
 * ssh の代わりにケースごとの偽 ssh がローカルの bare リポジトリへつなぐので、`git ls-remote origin` は
 * ネットワークに出ずに通り、URL を insteadOf で書き換えないのでゲートの照合（取得先の書き換え検知）も
 * 実物と同じに動く。gh の振る舞いは fake-gh.ts の偽 gh で別に与える。
 */
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOST_ENV_KEYS } from './github-doctor.ts';

export function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(' ')}: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

export interface FakeGitHubCheckout {
  /** ブランチ feature をチェックアウトした作業ツリー。 */
  cwd: string;
  /** feature の先端。push したならリモートの head も同じ。 */
  sha: string;
  /** origin の実体の bare リポジトリ。 */
  bare: string;
  /** 偽 ssh とレビュー記録の置き場所を指す環境変数。gh の PATH と FAKE_* は呼び出し側が足す。 */
  env: Record<string, string>;
}

/** プロセスの環境変数から、ホストの推定に使う変数を除いたもの（結果が実行したホストに左右されないように）。 */
export function neutralEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of HOST_ENV_KEYS) delete env[key];
  return env;
}

/**
 * `root` の下に、main と feature を持つリポジトリを作る。`push` なら feature を origin へ push し、
 * `setHead` なら `origin/HEAD` を main に向ける。
 */
export async function fakeGitHubCheckout(
  root: string,
  options: { push?: boolean; setHead?: boolean } = {},
): Promise<FakeGitHubCheckout> {
  const { push = true, setHead = true } = options;
  const caseDir = await mkdtemp(join(root, 'case-'));
  const bare = join(caseDir, 'remotes', 'owner', 'repo.git');
  await mkdir(bare, { recursive: true });
  git(caseDir, 'init', '-q', '--bare', '-b', 'main', bare);
  // git は `<ssh> [オプション…] github.com "git-upload-pack '/owner/repo.git'"` の形で呼ぶ。
  // `-G` は ssh の種類を見分ける問い合わせで、失敗させると追加のオプションを渡さない。
  const fakeSsh = join(caseDir, 'fake-ssh');
  await writeFile(
    fakeSsh,
    [
      '#!/bin/sh',
      'for arg; do [ "$arg" = -G ] && exit 1; command=$arg; done',
      `exec sh -c "$(printf '%s' "$command" | sed "s|'/owner/|'${caseDir}/remotes/owner/|")"`,
      '',
    ].join('\n'),
  );
  await chmod(fakeSsh, 0o755);
  const cwd = join(caseDir, 'work');
  await mkdir(cwd);
  git(cwd, 'init', '-q', '-b', 'main');
  await writeFile(join(cwd, 'README'), 'seed');
  git(cwd, 'add', 'README');
  git(cwd, 'commit', '-qm', 'seed');
  const mainSha = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'push', '-q', bare, 'main');
  git(cwd, 'remote', 'add', 'origin', 'ssh://github.com/owner/repo.git');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', mainSha);
  if (setHead) git(cwd, 'remote', 'set-head', 'origin', 'main');
  git(cwd, 'checkout', '-q', '-b', 'feature');
  await writeFile(join(cwd, 'change'), 'change');
  git(cwd, 'add', 'change');
  git(cwd, 'commit', '-qm', 'change');
  const sha = git(cwd, 'rev-parse', 'HEAD');
  if (push) git(cwd, 'push', '-q', bare, 'feature');
  return {
    cwd,
    sha,
    bare,
    env: {
      GIT_SSH_COMMAND: fakeSsh,
      CLAUDE_PROJECT_DIR: cwd,
      XDG_STATE_HOME: join(caseDir, 'state'),
    },
  };
}

/** `sha` に収束の証跡を書く（record-pr-review.ts が収束時に書く行と同じ形）。 */
export async function attest(checkout: FakeGitHubCheckout, sha = checkout.sha): Promise<void> {
  const directory = join(checkout.cwd, '.git', 'claude', 'pr-review');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'attestations.jsonl'),
    `${JSON.stringify({
      sha,
      repo: 'owner/repo',
      host: 'github.com',
      branch: 'feature',
      checkout: checkout.cwd,
      rounds: ['1', '0(codex)'],
      accepted: false,
      at: '2026-01-01T00:00:00.000Z',
    })}\n`,
    { flag: 'a' },
  );
}
