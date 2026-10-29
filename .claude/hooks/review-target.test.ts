import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { originRepository, resolveTarget } from './hook-utils.ts';
import { formatIsoUtc, nowMs } from './iso-time.ts';
import { prCreateInvocation } from './pr-create-command.ts';
import { ledgerFile, sameRemoteRepository, type Attestation } from './pr-review-gate.ts';
import { readRounds, reviewCountFile } from './review-count.ts';

const hooks = import.meta.dir;

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    ['git', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always', ...args],
    {
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
    },
  );
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(' ')}: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function commit(cwd: string, name: string): Promise<string> {
  await writeFile(join(cwd, name), name);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-qm', name);
  return git(cwd, 'rev-parse', 'HEAD');
}

/**
 * 実物のサブモジュールと worktree で作る構成:
 *   remotes/acme/{super,lib,inner}.git  bare のリモート
 *   super                         ルート（branch root-work）。プロジェクトディレクトリ
 *   super/.claude/worktrees/with space   ルートの linked worktree（branch root-wt）
 *   super/lib                     サブモジュール（branch lib-work）
 *   super/lib/.claude/worktrees/libwt     サブモジュールの linked worktree（branch lib-feature）
 *   super/lib/inner               入れ子のサブモジュール（branch inner-work）
 */
let base = '';
const at = {
  super: '',
  rootWorktree: '',
  lib: '',
  libWorktree: '',
  inner: '',
};
const remote = { super: '', lib: '' };

async function run(
  script: string,
  cwd: string,
  args: string[] = [],
  stdin?: unknown,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(['bun', join(hooks, script), ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: at.super, ...env },
    stdin: stdin === undefined ? 'ignore' : new Blob([JSON.stringify(stdin)]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

const denied = (stdout: string): boolean => stdout.includes('"permissionDecision":"deny"');

const ledger = (): Attestation[] => {
  const file = join(at.super, '.git', 'claude', 'pr-review', 'attestations.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

/** 2 ラウンド目を codex の 0 件で記録して、今の HEAD を収束させる。 */
async function converge(dir: string): Promise<void> {
  expect((await run('record-pr-review.ts', dir, ['1'])).code).toBe(0);
  const result = await run('record-pr-review.ts', dir, ['0', 'codex']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('証跡を記録');
}

/** pre-bash-guard を Bash の PreToolUse として動かす。 */
const bash = (cwd: string, command: string, env: Record<string, string> = {}) =>
  run('pre-bash-guard.ts', at.super, [], { cwd, tool_input: { command } }, env);

/** 1 回だけ止めたことを確かめる（stdout に別の判定 JSON を出さない）。 */
function expectSingleBlock(result: { code: number; stdout: string; stderr: string }): void {
  expect(result.code).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr.match(/BLOCKED:/gu)).toHaveLength(1);
}

let previousSshCommand: string | undefined;

beforeAll(async () => {
  base = realpathSync(await mkdtemp(join(tmpdir(), 'review-target-')));
  const remotes = join(base, 'remotes', 'acme');
  await mkdir(remotes, { recursive: true });
  // origin は `ssh://github.com/acme/<name>.git` で書き、ssh の代わりにローカルの bare リポジトリへ
  // つなぐ。URL を insteadOf で書き換えないので、ゲートが見る URL と取得先の URL が一致する。
  // git は `<script> [ssh のオプション…] github.com "git-upload-pack '/acme/<name>.git'"` の形で呼ぶ
  // （ゲートは -o BatchMode=yes を足す）。最後の引数がリモートで実行するコマンドになる。
  // `-G` は git が ssh の種類を見分けるための問い合わせで、失敗させると追加のオプションを渡さない。
  const fakeSsh = join(base, 'fake-ssh');
  await writeFile(
    fakeSsh,
    [
      '#!/bin/sh',
      'for arg; do [ "$arg" = -G ] && exit 1; command=$arg; done',
      `exec sh -c "$(printf '%s' "$command" | sed "s|'/acme/|'${base}/remotes/acme/|")"`,
      '',
    ].join('\n'),
  );
  await chmod(fakeSsh, 0o755);
  previousSshCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = fakeSsh;
  const seed = async (name: string, setup?: (clone: string) => void) => {
    const bare = join(remotes, `${name}.git`);
    git(base, 'init', '-q', '--bare', '-b', 'main', bare);
    const clone = join(base, `seed-${name}`);
    git(base, 'clone', '-q', bare, clone);
    git(clone, 'checkout', '-q', '-b', 'main');
    await commit(clone, `${name}-seed`);
    setup?.(clone);
    git(clone, 'push', '-q', 'origin', 'main');
    return bare;
  };
  const innerRemote = await seed('inner');
  remote.lib = await seed('lib', (clone) => {
    git(clone, 'submodule', 'add', '-q', innerRemote, 'inner');
    git(clone, 'commit', '-qm', 'add inner');
  });
  remote.super = await seed('super', (clone) => {
    git(clone, 'submodule', 'add', '-q', remote.lib, 'lib');
    git(clone, 'commit', '-qm', 'add lib');
  });
  at.super = join(base, 'super');
  git(base, 'clone', '-q', remote.super, at.super);
  git(at.super, 'submodule', 'update', '-q', '--init', '--recursive');
  at.lib = join(at.super, 'lib');
  at.inner = join(at.lib, 'inner');
  // サブモジュールの HEAD を動かしても、親の追跡ファイルの変更として数えない。
  git(at.super, 'config', 'submodule.lib.ignore', 'all');
  git(at.lib, 'config', 'submodule.inner.ignore', 'all');
  for (const [repo, name] of [
    [at.super, 'super'],
    [at.lib, 'lib'],
    [at.inner, 'inner'],
  ] as const) {
    git(repo, 'remote', 'set-url', 'origin', `ssh://github.com/acme/${name}.git`);
    git(repo, 'remote', 'set-head', 'origin', 'main');
  }
  git(at.super, 'checkout', '-q', '-b', 'root-work');
  git(at.lib, 'checkout', '-q', '-b', 'lib-work');
  git(at.inner, 'checkout', '-q', '-b', 'inner-work');
  at.rootWorktree = join(at.super, '.claude', 'worktrees', 'with space');
  git(at.super, 'worktree', 'add', '-q', '-b', 'root-wt', at.rootWorktree, 'origin/main');
  at.libWorktree = join(at.lib, '.claude', 'worktrees', 'libwt');
  git(at.lib, 'worktree', 'add', '-q', '-b', 'lib-feature', at.libWorktree, 'origin/main');
  // チェックアウトごとに index と HEAD が別なので、並行してコミットしてよい。
  await Promise.all(Object.entries(at).map(([name, dir]) => commit(dir, `${name}-change`)));
});

afterAll(async () => {
  if (previousSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = previousSshCommand;
  if (base) await rm(base, { recursive: true, force: true });
});

/** 作業場所ごとのディレクトリ・ブランチ・記録が置かれる git 共通ディレクトリ。 */
const locations = () => [
  { name: 'ルート', dir: at.super, branch: 'root-work', common: join(at.super, '.git') },
  {
    name: 'ルートの worktree',
    dir: at.rootWorktree,
    branch: 'root-wt',
    common: join(at.super, '.git'),
  },
  {
    name: 'サブモジュール',
    dir: at.lib,
    branch: 'lib-work',
    common: join(at.super, '.git', 'modules', 'lib'),
  },
  {
    name: 'サブモジュールの worktree',
    dir: at.libWorktree,
    branch: 'lib-feature',
    common: join(at.super, '.git', 'modules', 'lib'),
  },
  {
    name: '入れ子のサブモジュール',
    dir: at.inner,
    branch: 'inner-work',
    common: join(at.super, '.git', 'modules', 'lib', 'modules', 'inner'),
  },
];

describe('gh pr create の受け付ける形', () => {
  const start = '/work/root';
  const target = { repo: 'acme/x', head: 'feat' };
  test.each([
    ['gh pr create -R acme/x --head feat', { cwd: start, ...target }],
    ['cd lib && gh pr create -R acme/x -H feat', { cwd: '/work/root/lib', ...target }],
    [
      'cd lib && cd inner && gh pr create --fill -R acme/x --head feat',
      { cwd: '/work/root/lib/inner', ...target },
    ],
    [
      'cd "with space" && gh pr create --repo acme/x --head=feat',
      { cwd: '/work/root/with space', ...target },
    ],
    ['cd /abs/path && gh pr create -R acme/x --head feat', { cwd: '/abs/path', ...target }],
    ['gh -R acme/x pr create --head feat', { cwd: start, ...target }],
    ['gh pr --repo=acme/x create --head feat', { cwd: start, ...target }],
    ['gh pr create -R acme/x --head feat -t "--head nope"', { cwd: start, ...target }],
    ['gh pr create -R acme/x --title --head --head=feat', { cwd: start, ...target }],
    [
      'gh pr create -R acme/x --head feat --title "cd elsewhere && gh pr create"',
      { cwd: start, ...target },
    ],
    ['gh pr new -R acme/x --head feat', { cwd: start, ...target }],
    ['gh -R acme/x pr new --head feat', { cwd: start, ...target }],
    ['gh pr create -d -R acme/x -H feat -w', { cwd: start, ...target }],
    ['gh pr create --draft --repo=acme/x --head=feat --fill-verbose', { cwd: start, ...target }],
    ['gh pr create -T tpl.md -t "-Hnope" -R acme/x --head feat', { cwd: start, ...target }],
    ['gh pr create -R acme/x --head acme:feat', { cwd: start, repo: 'acme/x', head: 'acme:feat' }],
  ])('%p を受け付ける', (command, expected) => {
    expect(prCreateInvocation(command, start)).toEqual({ kind: 'canonical', ...expected });
  });

  test.each([
    ['gh pr create', '-R/--repo と --head/-H'],
    ['gh pr new --fill', '-R/--repo と --head/-H'],
    ['gh pr create --head feat', '-R/--repo'],
    ['cd lib && gh pr create -H feat', '-R/--repo'],
    ['gh pr create -R acme/x', '--head/-H'],
    ['gh -R acme/x pr new --fill', '--head/-H'],
  ])('-R か --head を欠く %p は、必要な形を示して受け付けない', (command, missing) => {
    const result = prCreateInvocation(command, start);
    expect(result).toEqual({
      kind: 'rejected',
      reason: expect.stringContaining(`${missing} の指定が必要です`),
    });
    expect(result.kind === 'rejected' && result.reason).toContain(
      '`gh pr create -R <host/owner/repo> --head <branch> ...`',
    );
  });

  const flags = '-R acme/x --head feat';
  test.each([
    `timeout 5 gh pr create ${flags}`,
    `bash -c "gh pr create ${flags}"`,
    `command gh pr create ${flags}`,
    `env -C lib gh pr create ${flags}`,
    `GH_REPO=acme/x gh pr create ${flags}`,
    `git switch x && gh pr create ${flags}`,
    `pushd lib && gh pr create ${flags}`,
    `(cd lib && gh pr create ${flags})`,
    `cd "$X" && gh pr create ${flags}`,
    `cd - && gh pr create ${flags}`,
    `cd lib; gh pr create ${flags}`,
    `cd lib || exit 1 && gh pr create ${flags}`,
    `gh pr create ${flags} || true`,
    `gh pr create ${flags} | cat`,
    `gh pr create ${flags} > out.txt`,
    `gh pr create ${flags} --body "$(cat body.md)"`,
    `gh pr create ${flags} && gh pr create ${flags}`,
    'git commit -m "mention gh pr create"',
    'git commit -m "mention gh pr new"',
    `timeout 5 gh pr new ${flags}`,
  ])('%p を受け付けない', (command) => {
    expect(prCreateInvocation(command, start)).toEqual({
      kind: 'rejected',
      reason: expect.stringContaining('単独のコマンドとして実行してください'),
    });
  });

  test.each([
    'gh pr create -Hfeat',
    'gh pr create -H=feat',
    'gh pr create -dH feat',
    'gh pr create -R=acme/lib',
    'gh pr create -Racme/lib',
    'gh -Racme/lib pr create',
    'gh -R=acme/lib pr create',
    'gh pr new -Hfeat',
    'gh pr create --unknown',
    'gh pr create -x',
    'gh pr create --draft=true',
    'gh pr create stray',
    'gh pr create -- --head feat',
    'gh pr create --head',
    'gh pr create --head ""',
    'gh pr create --head a --head b',
    'gh -R acme/a pr create -R acme/b',
    'gh --help pr create',
    'gh pr -d create',
  ])('意味を確定できないオプション %p は受け付けない', (command) => {
    const result = prCreateInvocation(command, start);
    expect(result.kind).toBe('rejected');
  });

  test.each([`g''h pr create`, `'gh' pr new`, 'g\\h pr new'])(
    'argv が gh pr create|new になる %p は対象外にしない',
    (command) => {
      expect(prCreateInvocation(command, start).kind).not.toBe('none');
    },
  );

  test.each([
    `timeout 5 g''h pr create`,
    `env FOO=1 'gh' pr new --fill`,
    `nohup /usr/local/bin/g''h pr create`,
    `bash -c 'gh pr create'`,
    `bash -c "g''h pr create"`,
    `sh -c 'bash -c "g\\\\h pr new"'`,
    // 入れ子の上限（3 段）に届いた文字列の中の、バックスラッシュで分けた gh も止める。
    `sh -c "sh -c 'sh -c \\"g\\\\\\\\h pr create\\"'"`,
  ])('ラッパー越しの %p は止める', (command) => {
    expect(prCreateInvocation(command, start).kind).toBe('rejected');
  });

  test('gh pr create を含まないコマンドは対象にしない', () => {
    expect(prCreateInvocation('cd lib && git push', start)).toEqual({ kind: 'none' });
  });

  test.each([
    `git commit -m "fix: handle \\"x 'y z'\\" case"`,
    `ssh host "bash -c 'docker exec c sh -c \\"ls -la\\"'"`,
    `sh -c "sh -c 'sh -c \\"sh -c x y\\"'"`,
  ])('入れ子の上限に届いても、gh を含まない %p は対象にしない', (command) => {
    expect(prCreateInvocation(command, start)).toEqual({ kind: 'none' });
  });

  test.each([
    'gh pr $SUB --fill',
    'gh pr "$SUB" -R acme/x --head feat',
    'gh pr `echo create` -R acme/x --head feat',
    'gh $CMD create -R acme/x --head feat',
    `cat <<EOF | sh\ngh ${Array.from({ length: 20 }, () => '-d').join(' ')} pr create -R acme/x --head feat\nEOF`,
  ])('pr やサブコマンドの位置が実行時まで決まらない %p は止める', (command) => {
    expect(prCreateInvocation(command, start).kind).toBe('rejected');
  });

  test.each([
    'GH=gh; "$GH" pr create -R github.com/acme/repo --head feat',
    '"$GH" pr new -R github.com/acme/repo --head feat',
    '$GH -R github.com/acme/repo pr create --head feat',
    'timeout 5 "$GH" pr create -R github.com/acme/repo --head feat',
    `bash -c '"$GH" pr create'`,
  ])('実行するコマンドの語が実行時まで決まらない %p も、pr create の並びなら止める', (command) => {
    expect(prCreateInvocation(command, start).kind).toBe('rejected');
  });

  test.each([
    'env "$GH" pr create -R github.com/acme/repo --head feat',
    'env FOO=1 -u BAR "$GH" pr create -R github.com/acme/repo --head feat',
    'env -- "$GH" pr new -R github.com/acme/repo --head feat',
    'gh --hostname x pr create -R github.com/acme/repo --head feat && echo done',
  ])('env 越しや、別のコマンドが続く %p も PR 作成として止める', (command) => {
    expect(prCreateInvocation(command, start).kind).toBe('rejected');
  });

  test.each([
    'gh --version && gh pr view "$PR"',
    'gh --version; gh auth status; gh pr checks "$PR"',
    'gh --version\ngh pr view "$(git branch --show-current)"',
    'gh --version && gh pr list --state open --json number,title,headRefName,author,url --limit 20 --repo o/r --search draft:false',
    'gh -h | head -5 && gh pr list --state open --search new',
    "git commit -m 'Use $GH pr new flow'",
    "git commit -m 'fix: handle ${GH} pr new invocations'",
    "git commit -m 'block `$GH pr create` too'",
    `gh pr comment 5 --body 'run "$GH" pr create to reproduce'`,
    "echo 'Total: $5 pr new'",
    'env "$EDITOR" notes.txt',
  ])('PR 作成でない %p は対象にしない', (command) => {
    expect(prCreateInvocation(command, start)).toEqual({ kind: 'none' });
  });

  test.each(['"$EDITOR" notes.txt', '"$X" pr list', '$X pr view 5 --json title', '"$X" create'])(
    '実行するコマンドの語が決まらなくても pr create の並びでない %p は対象にしない',
    (command) => {
      expect(prCreateInvocation(command, start)).toEqual({ kind: 'none' });
    },
  );

  test.each([
    'git commit -m "docs: use gh (GitHub CLI) for releases"',
    'git commit -m "chore: bump gh $VERSION"',
    "git commit -m 'chore: bump gh $VERSION'",
    "echo 'install gh $(cat ver)'",
    "cat > notes.md <<'EOF'\nInstall gh (https://cli.github.com) first.\nEOF",
  ])('gh に続く記号や変数を含むだけの文章 %p は対象にしない', (command) => {
    expect(prCreateInvocation(command, start)).toEqual({ kind: 'none' });
  });

  test.each([
    'gh pr checkout 5 && git switch -c new-thing',
    'gh pr view 12 --comments | grep -i new',
    'git log | head; gh pr list --search "is:open new"',
    'gh pr comment 5 --body "new fix"',
    'gh pr view 3 --json title -q .title | grep create',
    'gh -R acme/x pr list --search create',
  ])('pr の直後以外にある create・new の %p は対象にしない', (command) => {
    expect(prCreateInvocation(command, start)).toEqual({ kind: 'none' });
  });

  test.each([
    'gh --hostname pr create -R acme/x --head feat',
    'gh -d pr create -R acme/x --head feat',
    'gh -Racme/x pr create --head feat',
    'gh -R=acme/x pr create --head feat',
    'gh pr --body create new -R acme/x --head feat',
    'gh pr -x create -R acme/x --head feat',
    'gh --flag value pr list create',
  ])(
    'サブコマンドより前に -R/--repo 以外のオプションがある %p は、語の位置を確定できないので止める',
    (command) => {
      expect(prCreateInvocation(command, start).kind).toBe('rejected');
    },
  );

  test.each([
    'gh --version',
    'gh --help pr',
    'gh -x pr list',
    'gh pr -x list --search open',
    'gh pr view --json title',
    'gh --repo=acme/x pr list --search new',
  ])(
    '-R/--repo 以外のオプションがあっても create・new の並びが無い %p は対象にしない',
    (command) => {
      expect(prCreateInvocation(command, start)).toEqual({ kind: 'none' });
    },
  );

  test.each([
    ['gh pr new -R acme/x', '--head/-H'],
    ['gh pr new -R acme/x --fill', '--head/-H'],
  ])('--head を欠く %p は止める', (command, missing) => {
    expect(prCreateInvocation(command, start)).toEqual({
      kind: 'rejected',
      reason: expect.stringContaining(`${missing} の指定が必要です`),
    });
  });

  test.each([
    'bash -c "gh pr create"',
    `bash -c 'gh pr new -R acme/x --head feat'`,
    "bash <<'EOF'\ngh pr create -R acme/x --head feat\nEOF",
    'cat <<EOF | sh\ngh -R acme/x pr create --head feat\nEOF',
    'echo "$(gh pr create -R acme/x --head feat)"',
    'gh pr \\\n  create -R acme/x --head feat | cat',
  ])('引用符・heredoc・行継続の中の %p も止める', (command) => {
    expect(prCreateInvocation(command, start).kind).toBe('rejected');
  });
});

describe('origin の取得先の書き換えの比較', () => {
  test.each([
    ['git@github.com:acme/x.git', 'https://github.com/acme/x.git'],
    ['git@github.com:acme/x.git', 'https://github.com/acme/x'],
    ['ssh://github.com/acme/x.git', 'git+ssh://git@github.com/acme/x.git'],
    ['https://GitHub.com/Acme/X.git', 'ssh://git@github.com/acme/x.git'],
    ['ssh://git@ssh.github.com:443/acme/x.git', 'https://github.com/acme/x.git'],
    ['https://ghe.example.com:443/acme/x.git', 'https://ghe.example.com/acme/x.git'],
    ['ssh://git@ghe.example.com:22/acme/x.git', 'git@ghe.example.com:acme/x.git'],
    ['https://ghe.example.com:8443/acme/x.git', 'https://GHE.example.com:8443/acme/x'],
  ])('scheme とユーザー名だけが違う %p と %p は同じリポジトリとみなす', (configured, effective) => {
    expect(sameRemoteRepository(configured, effective)).toBe(true);
  });

  test.each([
    ['git@github.com:acme/x.git', 'https://mirror.example.com/acme/x.git'],
    ['git@github.com:acme/x.git', 'https://github.com/other/x.git'],
    ['git@github.com:acme/x.git', 'https://github.com/acme/y.git'],
    ['git@github.com:acme/x.git', '/srv/mirror/acme/x.git'],
    ['git@github.com:acme/x.git', 'file:///srv/mirror/acme/x.git'],
    ['/srv/acme/x.git', '/srv/acme/x.git'],
    ['https://ghe.example.com/acme/x.git', 'https://ghe.example.com:8443/acme/x.git'],
    ['ssh://git@ghe.example.com/acme/x.git', 'ssh://git@ghe.example.com:2222/acme/x.git'],
    ['git@github.com:acme/x.git', 'ssh://git@github.com:443/acme/x.git'],
    ['https://github.com/acme/x.git', 'https://github.com#@evil.example/acme/x.git'],
    ['https://github.com/acme/x.git', 'https://github.com?@evil.example/acme/x.git'],
  ])(
    'ホスト・ポート・owner/repo のどれかが違うか、ホストの無い %p と %p は別とみなす',
    (configured, effective) => {
      expect(sameRemoteRepository(configured, effective)).toBe(false);
    },
  );
});

describe('記録と証跡', () => {
  test('CLI は実行したチェックアウトの共通ディレクトリとブランチへ記録し、未収束なら証跡を書かない', async () => {
    const results = await Promise.all(
      locations().map(async (location) => ({
        location,
        result: await run('record-pr-review.ts', location.dir, ['1']),
        file: await reviewCountFile({ cwd: location.dir }),
      })),
    );
    for (const { location, result, file } of results) {
      expect(result.stderr).toBe('');
      expect(file).toBe(join(location.common, 'claude', 'pr-review', `${location.branch}.rounds`));
      expect(readFileSync(file, 'utf8')).toContain(git(location.dir, 'rev-parse', 'HEAD'));
    }
    // 別ブランチの記録は互いに混ざらない（同じ共通ディレクトリでもファイルが分かれる）。
    expect(await readRounds({ cwd: at.super })).toHaveLength(1);
    expect(await readRounds({ cwd: at.rootWorktree })).toHaveLength(1);
    expect(ledger()).toEqual([]);
  });

  test('収束したラウンドは、その HEAD の証跡を 1 件だけ台帳に書く', async () => {
    const result = await run('record-pr-review.ts', at.libWorktree, ['0', 'codex']);
    expect(result.code).toBe(0);
    expect(ledger()).toEqual([
      expect.objectContaining({
        sha: git(at.libWorktree, 'rev-parse', 'HEAD'),
        repo: 'acme/lib',
        branch: 'lib-feature',
        checkout: at.libWorktree,
        rounds: ['1', '0(codex)'],
        accepted: false,
      }),
    ]);
  });

  test('ssh:// の origin からホストと owner/repo を読む', async () => {
    expect(await originRepository(at.super)).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'super',
    });
  });

  test('resolveTarget は入力の cwd のトップレベルを対象にし、コマンド文字列は読まない', async () => {
    expect(
      await resolveTarget({ cwd: at.super, tool_input: { command: 'cd lib/inner && git push' } }),
    ).toEqual({ cwd: at.super });
    expect(await resolveTarget({ cwd: join(at.lib, 'inner') })).toEqual({ cwd: at.inner });
  });
});

describe('Bash の PR 作成ゲート', () => {
  test('push 済みの HEAD に証跡があれば通し、push 前や証跡の無い SHA なら止める', async () => {
    await run('record-pr-review.ts', at.lib, ['0', 'codex']);
    await run('record-pr-review.ts', at.super, ['0', 'codex']);

    const unpushed = await bash(
      at.libWorktree,
      'gh pr create -R github.com/acme/lib --head lib-feature',
    );
    expectSingleBlock(unpushed);
    expect(unpushed.stderr).toContain('ブランチがありません');

    git(at.libWorktree, 'push', '-q', 'origin', 'lib-feature');
    git(at.lib, 'push', '-q', 'origin', 'lib-work');
    git(at.super, 'push', '-q', 'origin', 'root-work');
    for (const [cwd, command] of [
      [at.libWorktree, 'gh pr create -R github.com/acme/lib --head lib-feature'],
      [at.super, 'gh pr create -R github.com/acme/super --head root-work'],
      [at.super, 'gh pr new --repo github.com/acme/super -H root-work'],
      [at.super, 'gh pr create -R github.com/ACME/super --head acme:root-work'],
      [at.super, 'cd lib && gh pr create -R github.com/acme/lib --head lib-work'],
      [
        at.super,
        'cd lib/.claude/worktrees/libwt && gh -R github.com/acme/lib pr create --fill --head lib-feature',
      ],
      // 現在のブランチでなく --head のブランチのリモート SHA で判定する。
      [at.lib, 'gh pr create -R github.com/acme/lib --head lib-feature --title "--head nope"'],
    ] as const) {
      const result = await bash(cwd, command);
      expect({ command, code: result.code, stderr: result.stderr }).toEqual({
        command,
        code: 0,
        stderr: '',
      });
    }

    const otherRepo = await bash(
      at.super,
      'cd lib && gh -R github.com/acme/super pr create --head lib-work',
    );
    expectSingleBlock(otherRepo);
    expect(otherRepo.stderr).toContain('-R/--repo');
    expect(otherRepo.stderr).toContain('origin に持つチェックアウトへ cd して');
    // ルートの worktree は収束していない。
    git(at.rootWorktree, 'push', '-q', 'origin', 'root-wt');
    expectSingleBlock(
      await bash(at.rootWorktree, 'gh pr create -R github.com/acme/super --head root-wt'),
    );
    expectSingleBlock(
      await bash(at.rootWorktree, 'gh pr new -R github.com/acme/super --head root-wt'),
    );

    // 収束後に積んだコミットは別の SHA なので、push しても証跡が無い。
    const attested = git(at.libWorktree, 'rev-parse', 'HEAD');
    const extra = await commit(at.libWorktree, 'after-review');
    git(at.libWorktree, 'push', '-q', 'origin', 'lib-feature');
    const stale = await bash(
      at.super,
      'cd lib/.claude/worktrees/libwt && gh pr create -R github.com/acme/lib --head lib-feature',
    );
    expectSingleBlock(stale);
    expect(stale.stderr).toContain(extra);
    expect(stale.stderr).toContain(attested);
  });

  test('収束後に同じ SHA へ指摘ありのラウンドを記録すると証跡を取り消し、再び収束すれば通す（指摘 0 件では取り消さず、直したコミットで記録すれば祖先の証跡を取り消す）', async () => {
    const command = 'cd lib && gh pr create -R github.com/acme/lib --head lib-work';
    const sha = git(at.lib, 'rev-parse', 'HEAD');
    expect((await bash(at.super, command)).code).toBe(0);

    // 指摘 0 件のラウンドは、codex でなく収束しなくても証跡を取り消さない。
    const clean = await run('record-pr-review.ts', at.lib, ['0']);
    expect(clean.stdout).not.toContain('証跡を取り消しました');
    expect((await bash(at.super, command)).code).toBe(0);

    const reopened = await run('record-pr-review.ts', at.lib, ['2']);
    expect(reopened.code).toBe(0);
    expect(reopened.stdout).toContain('証跡を取り消しました');
    expect(ledger().at(-1)).toEqual(
      expect.objectContaining({ sha, repo: 'acme/lib', host: 'github.com', revoked: true }),
    );
    const blocked = await bash(at.super, command);
    expectSingleBlock(blocked);
    expect(blocked.stderr).toContain(sha);

    const reconverged = await run('record-pr-review.ts', at.lib, ['0', 'codex']);
    expect(reconverged.stdout).toContain('証跡を記録');
    expect((await bash(at.super, command)).code).toBe(0);

    // 指摘を直してコミットしてから記録したラウンドは、HEAD の祖先にある証跡を取り消す。
    // リモートはまだ指摘のあったコミットを指しているので、PR を作れない。
    // 別のブランチ（lib-feature）だけで記録した、HEAD の祖先でない証跡は取り消さない。
    const otherBranch = ledger()
      .filter((entry) => entry.branch === 'lib-feature' && entry.revoked !== true)
      .at(-1)?.sha;
    expect(otherBranch).toBeDefined();
    const fixed = await commit(at.lib, 'fix-after-review');
    const afterFix = await run('record-pr-review.ts', at.lib, ['1']);
    expect(afterFix.stdout).toContain(sha);
    expect(afterFix.stdout).not.toContain(otherBranch ?? '');
    expect(afterFix.stderr).toBe('');
    expectSingleBlock(await bash(at.super, command));

    // 直したコミットで収束を記録して push すれば通る。
    expect((await run('record-pr-review.ts', at.lib, ['0', 'codex'])).stdout).toContain('証跡を記録');
    git(at.lib, 'push', '-q', 'origin', 'lib-work');
    expect(git(at.lib, 'rev-parse', 'HEAD')).toBe(fixed);
    expect((await bash(at.super, command)).code).toBe(0);
  });

  test.each([
    'timeout 5 gh pr create',
    'bash -c "gh pr create"',
    'git switch lib-work && gh pr create',
    'pushd lib && gh pr create',
    '(cd lib && gh pr create)',
    'cd "$X" && gh pr create',
    'git commit -m "mention gh pr create"',
    'gh pr create && gh pr create',
  ])('%p は 1 回だけ止める', async (command) => {
    // 行き先は収束済みで push 済みでも、受け付けない形なら止める。
    // -R と --head の有無より先に、単独のコマンドかどうかで止まる。
    const result = await bash(at.super, command, { X: at.lib });
    expectSingleBlock(result);
    expect(result.stderr).toContain('単独のコマンドとして実行してください');
  });

  test.each([
    'gh pr checkout 5 && git switch -c new-thing',
    'gh pr view 12 --comments | grep -i new',
    'git log | head; gh pr list --search "is:open new"',
    'gh pr comment 5 --body "new fix"',
    'gh pr checkout 5 && git switch -c new-x',
    'gh pr view 12 | grep new',
    'gh pr list --search new',
    `git commit -m "fix: handle \\"x 'y z'\\" case"`,
    `ssh host "bash -c 'docker exec c sh -c \\"ls -la\\"'"`,
  ])('PR 作成でない %p は止めない', async (command) => {
    const result = await bash(at.super, command);
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: '' });
  });

  test('サブモジュールの証跡はルートに使えず、ルートの証跡はサブモジュールに使えない', async () => {
    git(at.lib, 'push', '-q', remote.super, 'HEAD:refs/heads/borrowed-lib');
    const libSha = git(at.lib, 'rev-parse', 'HEAD');
    const fromLib = await bash(
      at.super,
      'gh pr create -R github.com/acme/super --head borrowed-lib',
    );
    expectSingleBlock(fromLib);
    expect(fromLib.stderr).toContain(libSha);

    git(at.super, 'push', '-q', remote.lib, 'HEAD:refs/heads/borrowed-root');
    expectSingleBlock(
      await bash(at.super, 'cd lib && gh pr create -R github.com/acme/lib --head borrowed-root'),
    );
  });
});

describe('-R と --head の明示', () => {
  test.each([
    ['gh pr create', '-R/--repo と --head/-H'],
    ['gh pr create --head root-work', '-R/--repo'],
    ['gh pr create -R github.com/acme/super', '--head/-H'],
  ])('収束済みでも、%p は必要な形を示して 1 回だけ止める', async (command, missing) => {
    const result = await bash(at.super, command);
    expectSingleBlock(result);
    expect(result.stderr).toContain(`${missing} の指定が必要です`);
    expect(result.stderr).toContain('`gh pr create -R <host/owner/repo> --head <branch> ...`');
  });

  test('-R が実行ディレクトリの origin と違えば止める', async () => {
    const result = await bash(at.super, 'gh pr create -R github.com/acme/other --head root-work');
    expectSingleBlock(result);
    expect(result.stderr).toContain('acme/other');
    expect(result.stderr).toContain('origin（acme/super）と異なります');
  });

  test('upstream リモートと gh repo set-default が別を指していても、origin の repo を明示すれば通す', async () => {
    git(at.super, 'remote', 'add', 'upstream', 'https://github.com/other/super.git');
    git(at.super, 'config', 'remote.upstream.gh-resolved', 'base');
    try {
      const result = await bash(at.super, 'gh pr create -R github.com/acme/super --head root-work');
      expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: '' });
      expectSingleBlock(
        await bash(at.super, 'gh pr create -R github.com/other/super --head root-work'),
      );
    } finally {
      git(at.super, 'remote', 'remove', 'upstream');
    }
  });

  test('-R はホストまで書いた形だけを受け付け、ホストが origin と違えば止める', async () => {
    const pass = 'gh pr create -R github.com/acme/super --head root-work';
    expect((await bash(at.super, pass)).code).toBe(0);
    for (const command of [
      'gh pr create -R acme/super --head root-work',
      'gh pr create -R https://github.com/acme/super --head root-work',
    ]) {
      const result = await bash(at.super, command);
      expectSingleBlock(result);
      expect(result.stderr).toContain('host/owner/repo の形');
    }
    const otherHost = await bash(
      at.super,
      'gh pr create -R ghe.example.com/acme/super --head root-work',
    );
    expectSingleBlock(otherHost);
    expect(otherHost.stderr).toContain('ホスト（ghe.example.com）');
    // GH_HOST はホストを明示した -R を上書きしない。
    expect((await bash(at.super, pass, { GH_HOST: 'ghe.example.com' })).code).toBe(0);
    git(at.super, 'remote', 'set-url', 'origin', remote.super);
    try {
      const local = await bash(at.super, pass);
      expectSingleBlock(local);
      expect(local.stderr).toContain('ホスト無し');
    } finally {
      git(at.super, 'remote', 'set-url', 'origin', 'ssh://github.com/acme/super.git');
    }
  });

  test('origin が ssh.github.com（443 番ポート経由の SSH）なら -R github.com で通し、SSH 設定の Host 別名は止める', async () => {
    const pass = 'gh pr create -R github.com/acme/super --head root-work';
    git(at.super, 'remote', 'set-url', 'origin', 'ssh://git@ssh.github.com:443/acme/super.git');
    try {
      // 偽の ssh は -G の問い合わせに失敗するので、ポートを渡せる種類だと git に伝える。
      const result = await bash(at.super, pass, { GIT_SSH_VARIANT: 'ssh' });
      expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: '' });
      git(at.super, 'remote', 'set-url', 'origin', 'git@github-work:acme/super.git');
      const alias = await bash(at.super, pass);
      expectSingleBlock(alias);
      expect(alias.stderr).toContain('origin のホスト（github-work）');
    } finally {
      git(at.super, 'remote', 'set-url', 'origin', 'ssh://github.com/acme/super.git');
    }
  });

  test('origin に URL が複数あれば、どれが対象か決められないので止める', async () => {
    const pass = 'gh pr create -R github.com/acme/super --head root-work';
    git(at.super, 'remote', 'set-url', '--add', 'origin', 'ssh://github.com/acme/mirror.git');
    try {
      const result = await bash(at.super, pass);
      expectSingleBlock(result);
      expect(result.stderr).toContain('読み取れません');
    } finally {
      git(at.super, 'remote', 'set-url', '--delete', 'origin', 'mirror');
    }
    expect((await bash(at.super, pass)).code).toBe(0);
  });

  test('--head の owner が origin の owner と違えば止める', async () => {
    const result = await bash(
      at.super,
      'gh pr create -R github.com/acme/super --head someone:root-work',
    );
    expectSingleBlock(result);
    expect(result.stderr).toContain('--head の owner（someone）');
  });
});

describe('入れ子のサブモジュールの台帳', () => {
  test('CLAUDE_PROJECT_DIR が無くても、入れ子のサブモジュールでの記録はルートのゲートから見える', async () => {
    const unset = { CLAUDE_PROJECT_DIR: '' };
    const result = await run('record-pr-review.ts', at.inner, ['0', 'codex'], undefined, unset);
    expect(result.stdout).toContain('証跡を記録');
    const sha = git(at.inner, 'rev-parse', 'HEAD');
    expect(ledger()).toContainEqual(
      expect.objectContaining({
        sha,
        repo: 'acme/inner',
        host: 'github.com',
        branch: 'inner-work',
      }),
    );
    git(at.inner, 'push', '-q', 'origin', 'inner-work');
    const gate = await bash(
      at.super,
      'cd lib/inner && gh pr create -R github.com/acme/inner --head inner-work',
    );
    expect({ code: gate.code, stderr: gate.stderr }).toEqual({ code: 0, stderr: '' });
  });

  test('台帳の場所は、どこから解いてもいちばん外側の git 共通ディレクトリになる', async () => {
    const saved = { cwd: process.cwd(), project: process.env.CLAUDE_PROJECT_DIR };
    const expected = join(at.super, '.git', 'claude', 'pr-review', 'attestations.jsonl');
    try {
      delete process.env.CLAUDE_PROJECT_DIR;
      for (const dir of [at.inner, at.lib, at.libWorktree, at.rootWorktree, at.super]) {
        process.chdir(dir);
        expect({ dir, file: await ledgerFile() }).toEqual({ dir, file: expected });
      }
      process.env.CLAUDE_PROJECT_DIR = at.inner;
      expect(await ledgerFile()).toBe(expected);
    } finally {
      process.chdir(saved.cwd);
      if (saved.project === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = saved.project;
    }
  });
});

describe('GitHub MCP の PR 作成ゲート', () => {
  const mcp = (head: string, repo = 'lib', extra: Record<string, unknown> = {}) => ({
    cwd: at.super,
    tool_name: 'mcp__github__create_pull_request',
    tool_input: { owner: 'acme', repo, head, base: 'main', title: 't', ...extra },
  });
  const gate = (input: unknown, env: Record<string, string> = {}) =>
    run('require-pr-self-review-mcp.ts', at.super, [], input, env);

  test('リモートの head が証跡の SHA なら通し、証跡の後に積んだコミットなら止める', async () => {
    // 直前のテストで証跡の後に積んだコミットが push されている。
    const stale = await gate(mcp('lib-feature'));
    expect(denied(stale.stdout)).toBe(true);
    expect(stale.stdout).toContain('収束の記録がありません');

    const result = await run('record-pr-review.ts', at.libWorktree, ['0', 'codex']);
    expect(result.stdout).toContain('証跡を記録');
    expect((await gate(mcp('lib-feature'))).stdout).toBe('');
    expect((await gate(mcp('acme:lib-feature'))).stdout).toBe('');
  });

  test('同じ SHA を別のブランチでも収束させても、先のブランチの証跡は残る', async () => {
    const file = join(at.super, '.git', 'claude', 'pr-review', 'attestations.jsonl');
    const original = readFileSync(file, 'utf8');
    const first = ledger().filter((entry) => entry.branch === 'lib-feature').at(-1);
    expect(first).toBeDefined();
    try {
      // 先のブランチの証跡がこの 1 件だけの台帳に、同じコミットを別ブランチで収束させた記録が続く。
      const twin = { ...first, branch: 'lib-twin' };
      await writeFile(file, `${JSON.stringify(first)}\n${JSON.stringify(twin)}\n`);
      expect((await gate(mcp('lib-feature'))).stdout).toBe('');
    } finally {
      await writeFile(file, original);
    }
  });

  test('別ホストの同名リポジトリの証跡は使わず、ホストが決まらなければ止める', async () => {
    expect((await gate(mcp('lib-feature'))).stdout).toBe('');
    const file = join(at.super, '.git', 'claude', 'pr-review', 'attestations.jsonl');
    const original = readFileSync(file, 'utf8');
    const sha = git(at.libWorktree, 'rev-parse', 'HEAD');
    // 別ホストに同名のリポジトリを持つチェックアウト。
    const gheCheckout = join(base, 'ghe-lib');
    git(base, 'init', '-q', '-b', 'lib-feature', gheCheckout);
    git(gheCheckout, 'remote', 'add', 'origin', 'ssh://ghe.example.com/acme/lib.git');
    const foreign: Attestation = {
      sha,
      repo: 'acme/lib',
      host: 'ghe.example.com',
      branch: 'lib-feature',
      checkout: gheCheckout,
      rounds: ['0(codex)'],
      accepted: false,
      at: formatIsoUtc(nowMs()),
    };
    try {
      await writeFile(file, `${original}${JSON.stringify(foreign)}\n`);
      const ambiguous = await gate(mcp('lib-feature'));
      expect(denied(ambiguous.stdout)).toBe(true);
      expect(ambiguous.stdout).toContain('複数のホスト');
      // 別ホストの記録だけでは、github.com の head を通さない。
      await writeFile(
        file,
        original
          .split('\n')
          .filter((line) => !line.includes('"lib-feature"'))
          .concat(JSON.stringify(foreign), '')
          .join('\n'),
      );
      const bashResult = await bash(
        at.libWorktree,
        'gh pr create -R github.com/acme/lib --head lib-feature',
      );
      expectSingleBlock(bashResult);
      expect(bashResult.stderr).toContain('収束の記録がありません');
    } finally {
      await writeFile(file, original);
    }
    expect((await gate(mcp('lib-feature'))).stdout).toBe('');
  });

  test('origin のホストを書き換えて記録し直せば、古いホストの記録に止められない', async () => {
    const before = git(at.libWorktree, 'remote', 'get-url', 'origin');
    expect((await gate(mcp('lib-feature'))).stdout).toBe('');
    // 同じ github.com のリポジトリを、ホスト名の違う SSH の別名で指す。
    git(at.libWorktree, 'config', 'remote.origin.url', 'ssh://github-work/acme/lib.git');
    try {
      const result = await run('record-pr-review.ts', at.libWorktree, ['0', 'codex']);
      expect(result.stdout).toContain('証跡を記録');
      const after = await gate(mcp('lib-feature'));
      expect(after.stdout).not.toContain('複数のホスト');
      expect(after.stdout).toBe('');
    } finally {
      git(at.libWorktree, 'config', 'remote.origin.url', before);
    }
    expect((await gate(mcp('lib-feature'))).stdout).toBe('');
  });

  test('記録したチェックアウトの origin が後から変わっていれば止める', async () => {
    const remotes = join(base, 'remotes', 'acme');
    const moved = join(remotes, 'moved.git');
    const other = join(remotes, 'other.git');
    git(base, 'init', '-q', '--bare', '-b', 'main', moved);
    git(base, 'init', '-q', '--bare', '-b', 'main', other);
    const repo = join(base, 'moved');
    git(base, 'init', '-q', '-b', 'moved-feat', repo);
    await commit(repo, 'moved-seed');
    git(repo, 'remote', 'add', 'origin', 'ssh://github.com/acme/moved.git');
    await converge(repo);
    git(repo, 'push', '-q', 'origin', 'moved-feat');
    git(other, 'fetch', '-q', moved, 'moved-feat:moved-feat');
    expect((await gate(mcp('moved-feat', 'moved', { base: undefined }))).stdout).toBe('');
    git(repo, 'remote', 'set-url', 'origin', 'ssh://github.com/acme/other.git');
    const result = await gate(mcp('moved-feat', 'moved', { base: undefined }));
    expect(denied(result.stdout)).toBe(true);
    expect(result.stdout).toContain('いまも同じ origin を持つチェックアウトが見つかりません');
  });

  test('origin にホストの無いチェックアウトの記録は候補にしない', async () => {
    const remotes = join(base, 'remotes', 'acme');
    const bare = join(remotes, 'hostless.git');
    git(base, 'init', '-q', '--bare', '-b', 'main', bare);
    const repo = join(base, 'hostless');
    git(base, 'init', '-q', '-b', 'hostless-feat', repo);
    await commit(repo, 'hostless-seed');
    git(repo, 'remote', 'add', 'origin', bare);
    await converge(repo);
    git(repo, 'push', '-q', 'origin', 'hostless-feat');
    expect(ledger()).toContainEqual(expect.objectContaining({ repo: 'acme/hostless', host: null }));
    const result = await gate(mcp('hostless-feat', 'hostless'));
    expect(denied(result.stdout)).toBe(true);
    expect(result.stdout).toContain('いまも同じ origin を持つチェックアウトが見つかりません');
  });

  test('base が origin の default branch と違えば止める', async () => {
    expect((await gate(mcp('lib-feature'))).stdout).toBe('');
    const other = await gate(mcp('lib-feature', 'lib', { base: 'release' }));
    expect(denied(other.stdout)).toBe(true);
    expect(other.stdout).toContain('default branch（main）と異なります');
    const bash1 = await bash(
      at.libWorktree,
      'gh pr create -R github.com/acme/lib --head lib-feature --base release',
    );
    expectSingleBlock(bash1);
    expect(bash1.stderr).toContain('default branch（main）と異なります');
    expect(
      (await bash(at.libWorktree, 'gh pr create -R github.com/acme/lib --head lib-feature -B main'))
        .code,
    ).toBe(0);
    expect(
      (
        await bash(
          at.libWorktree,
          'gh pr create -R github.com/acme/lib --head lib-feature --base=main',
        )
      ).code,
    ).toBe(0);
    expectSingleBlock(
      await bash(
        at.libWorktree,
        'gh pr create -R github.com/acme/lib --head lib-feature --base main --base main',
      ),
    );
    const alias = await gate(
      mcp('lib-feature', 'lib', { base: undefined, base_branch: 'release' }),
    );
    expect(denied(alias.stdout)).toBe(true);
    expect(alias.stdout).toContain('default branch（main）と異なります');
    const conflicting = await gate(
      mcp('lib-feature', 'lib', { base: 'main', base_branch: 'release' }),
    );
    expect(denied(conflicting.stdout)).toBe(true);
    expect(conflicting.stdout).toContain('食い違っています');
  });

  test('--base を省いても、ブランチ設定の gh-merge-base が default branch と違えば止める', async () => {
    const command = 'gh pr create -R github.com/acme/lib --head lib-feature';
    git(at.libWorktree, 'config', 'branch.lib-feature.gh-merge-base', 'release');
    try {
      const result = await bash(at.libWorktree, command);
      expectSingleBlock(result);
      expect(result.stderr).toContain('base（release）');
    } finally {
      git(at.libWorktree, 'config', '--unset', 'branch.lib-feature.gh-merge-base');
    }
    expect((await bash(at.libWorktree, command)).code).toBe(0);
  });

  test('--base を省くと、チェックアウト中のブランチの gh-merge-base も確かめる', async () => {
    const command = 'gh pr create -R github.com/acme/lib --head lib-feature';
    git(at.libWorktree, 'checkout', '-q', '-b', 'caller');
    try {
      git(at.libWorktree, 'config', 'branch.caller.gh-merge-base', 'release');
      const result = await bash(at.libWorktree, command);
      expectSingleBlock(result);
      expect(result.stderr).toContain('base（release）');
    } finally {
      git(at.libWorktree, 'checkout', '-q', 'lib-feature');
      git(at.libWorktree, 'branch', '-q', '-D', 'caller');
    }
    expect((await bash(at.libWorktree, command)).code).toBe(0);
  });

  test('origin/HEAD が無いチェックアウトでは base を確かめられないので止め、設定すれば通す', async () => {
    const bare = join(base, 'remotes', 'acme', 'headless.git');
    git(base, 'init', '-q', '--bare', '-b', 'main', bare);
    const repo = join(base, 'headless');
    git(base, 'init', '-q', '-b', 'main', repo);
    await commit(repo, 'headless-main');
    git(repo, 'remote', 'add', 'origin', 'ssh://github.com/acme/headless.git');
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'checkout', '-q', '-b', 'headless-feat');
    await commit(repo, 'headless-feat');
    await converge(repo);
    git(repo, 'push', '-q', 'origin', 'headless-feat');
    const result = await gate(mcp('headless-feat', 'headless'));
    expect(denied(result.stdout)).toBe(true);
    expect(result.stdout).toContain('git remote set-head origin --auto');
    git(repo, 'fetch', '-q', 'origin');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    expect((await gate(mcp('headless-feat', 'headless'))).stdout).toBe('');
  });

  test('台帳に記録の無いブランチは止める', async () => {
    const result = await gate(mcp('never-recorded', 'inner'));
    expect(denied(result.stdout)).toBe(true);
    expect(result.stdout).toContain('チェックアウトが見つかりません');
  });

  test('記録したチェックアウトが消えていれば止める', async () => {
    const gone = join(at.lib, '.claude', 'worktrees', 'gone');
    git(at.lib, 'worktree', 'add', '-q', '-b', 'gone-feature', gone, 'origin/main');
    await commit(gone, 'gone-change');
    await converge(gone);
    git(gone, 'push', '-q', 'origin', 'gone-feature');
    expect((await gate(mcp('gone-feature'))).stdout).toBe('');
    git(at.lib, 'worktree', 'remove', '--force', gone);
    const result = await gate(mcp('gone-feature'));
    expect(denied(result.stdout)).toBe(true);
    expect(result.stdout).toContain('チェックアウトが見つかりません');
  });

  test('head の owner が違うフォーク間 PR と、食い違う別名は止める', async () => {
    const fork = await gate(mcp('someone:lib-feature'));
    expect(denied(fork.stdout)).toBe(true);
    expect(fork.stdout).toContain('フォーク間');
    const conflicting = await gate(
      mcp('lib-feature', 'lib', { repository_full_name: 'acme/super' }),
    );
    expect(denied(conflicting.stdout)).toBe(true);
    expect(conflicting.stdout).toContain('食い違っています');
  });

  test('リモートが応答しなければ、ls-remote を打ち切って止め、すぐに終了する', async () => {
    const repo = join(base, 'hang');
    git(base, 'init', '-q', '-b', 'feat', repo);
    await commit(repo, 'hang-seed');
    git(repo, 'remote', 'add', 'origin', 'ssh://example.invalid/acme/hang.git');
    await converge(repo);
    const sleeper = join(base, 'sleeping-ssh');
    await writeFile(sleeper, '#!/bin/sh\nsleep 30\n');
    await chmod(sleeper, 0o755);
    const started = performance.now();
    const result = await run(
      'require-pr-self-review-mcp.ts',
      repo,
      [],
      mcp('feat', 'hang', { base: undefined }),
      { CLAUDE_HOOK_TEST_REMOTE_FETCH_TIMEOUT_MS: '500', GIT_SSH_COMMAND: sleeper },
    );
    const elapsed = performance.now() - started;
    expect(denied(result.stdout)).toBe(true);
    expect(result.stdout).toContain('git ls-remote がタイムアウトしました');
    expect(result.code).toBe(0);
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  test('origin の取得先が insteadOf で書き換えられていれば、Bash と MCP の両経路で止める', async () => {
    // 書き換え先は証跡のある SHA を持つミラー。SHA が合っても、PR を作る相手と別のリポジトリなので止める。
    const mirror = join(base, 'remotes', 'mirror');
    await mkdir(mirror, { recursive: true });
    for (const [name, dir, branch] of [
      ['super', at.super, 'root-work'],
      ['lib', at.libWorktree, 'lib-feature'],
    ] as const) {
      const bare = join(mirror, `${name}.git`);
      git(base, 'init', '-q', '--bare', '-b', 'main', bare);
      git(dir, 'push', '-q', bare, `HEAD:refs/heads/${branch}`);
    }
    const bashPass = 'gh pr create -R github.com/acme/lib --head lib-feature';
    const rewrite = (key: 'insteadOf' | 'pushInsteadOf', on: boolean) => {
      for (const [dir, name] of [
        [at.super, 'super'],
        [at.lib, 'lib'],
      ] as const) {
        const args = [
          `url.${join(mirror, `${name}.git`)}.${key}`,
          `ssh://github.com/acme/${name}.git`,
        ];
        if (on) git(dir, 'config', ...args);
        else git(dir, 'config', '--unset', ...args.slice(0, 1));
      }
    };
    const message = 'insteadOf で書き換えられていて';
    rewrite('insteadOf', true);
    try {
      for (const [cwd, command] of [
        [at.super, 'gh pr create -R github.com/acme/super --head root-work'],
        [at.libWorktree, bashPass],
      ] as const) {
        const result = await bash(cwd, command);
        expectSingleBlock(result);
        expect(result.stderr).toContain(message);
      }
      const viaMcp = await gate(mcp('lib-feature'));
      expect(denied(viaMcp.stdout)).toBe(true);
      expect(viaMcp.stdout).toContain(message);
    } finally {
      rewrite('insteadOf', false);
    }
    // push の転送先だけを書き換える設定は取得先を変えないので通す。
    rewrite('pushInsteadOf', true);
    try {
      expect((await bash(at.libWorktree, bashPass)).code).toBe(0);
      expect((await gate(mcp('lib-feature'))).stdout).toBe('');
    } finally {
      rewrite('pushInsteadOf', false);
    }
    expect(
      (await bash(at.super, 'gh pr create -R github.com/acme/super --head root-work')).code,
    ).toBe(0);
    expect((await gate(mcp('lib-feature'))).stdout).toBe('');
  });

  test('同じリポジトリへ scheme やユーザー名だけを変える insteadOf は通し、別のホストや owner/repo へ向ける書き換えは止める', async () => {
    const bashPass = 'gh pr create -R github.com/acme/lib --head lib-feature';
    const withRewrite = async (target: string, check: () => Promise<void>) => {
      const key = `url.${target}.insteadOf`;
      git(at.lib, 'config', key, 'ssh://github.com/acme/');
      try {
        await check();
      } finally {
        git(at.lib, 'config', '--unset', key);
      }
    };
    // 取得先は ssh://git@github.com/acme/lib.git（scheme の別名とユーザー名だけが変わる）。
    await withRewrite('git+ssh://git@github.com/acme/', async () => {
      expect((await bash(at.libWorktree, bashPass)).code).toBe(0);
      expect((await gate(mcp('lib-feature'))).stdout).toBe('');
    });
    const message = 'insteadOf で書き換えられていて';
    for (const target of ['ssh://mirror.example.com/acme/', 'ssh://github.com/other/']) {
      await withRewrite(target, async () => {
        const result = await bash(at.libWorktree, bashPass);
        expectSingleBlock(result);
        expect(result.stderr).toContain(message);
        const viaMcp = await gate(mcp('lib-feature'));
        expect(denied(viaMcp.stdout)).toBe(true);
        expect(viaMcp.stdout).toContain(message);
      });
    }
  });
});

describe('hook の起動ラッパー', () => {
  const launch = (cwd: string, script: string, input: unknown) =>
    run('run-or-skip-for-cursor.ts', cwd, [script], input);

  test('プロセスの現在地がサブモジュールの中でも、プロジェクトの hook を動かす', async () => {
    const result = await launch(at.lib, '.claude/hooks/pre-bash-guard.ts', {
      hook_event_name: 'PreToolUse',
      cwd: at.lib,
      tool_input: { command: 'timeout 5 gh pr create' },
    });
    expectSingleBlock(result);
    expect(result.stderr).toContain('単独のコマンドとして実行してください');
  });

  const projectRoot = join(hooks, '..', '..');
  const adapters = [
    {
      name: 'Codex',
      script: '../../.codex/run-shared-hook.ts',
      input: (cwd: string, command: string) => ({
        hook_event_name: 'PreToolUse',
        cwd,
        tool_input: { command },
      }),
    },
    {
      name: 'Cursor',
      script: '../../.cursor/run-shared-hook.ts',
      input: (cwd: string, command: string) => ({
        hook_event_name: 'preToolUse',
        cwd,
        tool_input: { command },
      }),
    },
  ];

  test.each(adapters)(
    '$name のアダプターは、プロセスの現在地がサブモジュールの中でもプロジェクトの hook を動かす',
    async ({ script, input }) => {
      const result = await run(
        script,
        at.inner,
        ['.claude/hooks/pre-bash-guard.ts'],
        input(at.inner, 'timeout 5 gh pr create'),
      );
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('単独のコマンドとして実行してください');
    },
  );

  test.each(adapters)(
    '$name のアダプターは、hook が見つからなければ PreToolUse を止める',
    async ({ script, input }) => {
      const result = await run(
        script,
        at.lib,
        ['.claude/hooks/no-such-hook.ts'],
        input(at.lib, 'true'),
      );
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('hook が見つかりません');
    },
  );

  test('Codex の hook コマンドは、入れ子のサブモジュールからいちばん外側のトップレベルを解く', () => {
    const config = JSON.parse(readFileSync(join(projectRoot, '.codex', 'hooks.json'), 'utf8'));
    const command: string = config.hooks.PreToolUse[0].hooks[0].command;
    const match = command.match(/^bun "(.*)\/\.codex\/run-shared-hook\.ts" /su);
    expect(match).not.toBeNull();
    const resolved = Bun.spawnSync(['sh', '-c', `printf %s "${match?.[1] ?? ''}"`], {
      cwd: at.inner,
      stdout: 'pipe',
    });
    expect(new TextDecoder().decode(resolved.stdout)).toBe(at.super);
  });

  test('hook が見つからなければ、PreToolUse では黙って通さずに止める', async () => {
    const result = await launch(at.lib, '.claude/hooks/no-such-hook.ts', {
      hook_event_name: 'PreToolUse',
      cwd: at.lib,
      tool_input: { command: 'true' },
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('hook が見つかりません');
  });
});
