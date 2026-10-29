/**
 * hook が GitHub に問い合わせる操作を 1 か所に集めた Port。
 *
 * 既定のアダプタは gh の REST 呼び出し（`gh api repos/...`）だけを使う。`gh pr view`・`gh repo view`
 * のように内部で GraphQL を使うサブコマンドは、GraphQL を拒否して REST だけを通す実行環境で
 * 失敗し、PR の有無すら判定できなくなるため使わない。GraphQL でしか取れない未解決スレッドは、
 * 取れれば使う任意の操作として分け、失敗しても他の操作の結果を左右しない。
 *
 * 対象リポジトリは origin の URL で決める（PR 作成ゲートと同じく、origin を PR のリポジトリとみなす）。
 * gh のリポジトリ解決（`gh repo set-default`・複数リモートの推測）には頼らない。
 *
 * 対象にするのは基本の経路（origin の、いまのブランチの PR）だけで、fork 構成や SSH の Host 別名などの
 * まれな構成までは解決しない（.claude/rules/ci-workflow.md の「push 後: レビューコメントに対応する」）。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord, originRepository } from './hook-utils.ts';

/** gh を 1 回実行した結果。実行ファイルが見つからないことは終了コードと区別する。 */
export type GhOutcome =
  | { kind: 'not_found' }
  | { kind: 'exited'; exitCode: number; stdout: string; stderr: string };

/** gh の実行を差し替える口。テストは偽の結果を返す runner を渡す。 */
export type GhRunner = (args: readonly string[], cwd: string) => Promise<GhOutcome>;

/** GitHub を確認できない理由の種別。利用者へ示す次の一手が種別ごとに異なる。 */
export type GitHubUnavailableCause =
  | 'gh_missing'
  | 'unauthenticated'
  | 'access_denied'
  | 'network'
  | 'unknown';

export interface GitHubUnavailable {
  kind: 'unavailable';
  cause: GitHubUnavailableCause;
  /** 何ができず、次に何をすればよいかを書いた文。 */
  reason: string;
}

export type Fetched<T> = { kind: 'ok'; value: T } | GitHubUnavailable;

export interface OpenPullRequest {
  number: number;
  headSha: string;
  /** PR の base ブランチ名。応答に無ければ null。 */
  baseRef: string | null;
  url: string;
  /** `owner/repo`。案内文で REST の呼び出し先を示すのに使う。 */
  repository: string;
}

/** createPullRequest に渡す内容。head は origin のブランチ名（同じリポジトリ内の PR）。 */
export interface PullRequestRequest {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

/** 作成要求に GitHub が返した PR。head・base は照合のため応答の値をそのまま持つ。 */
export interface CreatedPullRequest {
  number: number;
  url: string;
  headSha: string;
  baseRef: string;
}

/** Port が対象にする origin のリポジトリと、PR の head になるブランチ。 */
export interface RepositoryTarget {
  host: string;
  owner: string;
  repo: string;
  branch: string;
}

export type PullRequestLookup =
  | { kind: 'no_pr' }
  | { kind: 'found'; pullRequest: OpenPullRequest }
  | GitHubUnavailable;

export interface ReviewThreadComment {
  databaseId: number;
  author: { login: string } | null;
  body: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  /** 最後のコメント 1 件。 */
  comments: { nodes: ReviewThreadComment[] };
  /** 最初のコメント 1 件。 */
  firstComment: { nodes: Omit<ReviewThreadComment, 'databaseId'>[] };
}

export interface GitHubPort {
  /** Port が問い合わせる origin のリポジトリと head のブランチ。gh は使わない。 */
  target(): Promise<Fetched<RepositoryTarget>>;
  /** origin のリポジトリで、現在のブランチを head とする open な PR。 */
  findOpenPullRequest(): Promise<PullRequestLookup>;
  /**
   * PR を REST で作る。失敗は unavailable で返すが、要求が GitHub に届いた後の失敗（応答の途絶など）
   * では PR が作られている場合がある。呼び出し側は再試行する前に findOpenPullRequest で確かめる
   * （この Port の findOpenPullRequest は結果を使い回すので、確かめるときは Port を作り直す）。
   */
  createPullRequest(request: PullRequestRequest): Promise<Fetched<CreatedPullRequest>>;
  /** origin のリポジトリを REST で読めるか。読めれば `owner/repo` の正式名。 */
  probeRest(): Promise<Fetched<string>>;
  /** GraphQL の問い合わせが通るか。通ればログイン名。 */
  probeGraphql(): Promise<Fetched<string>>;
  /** gh が認証しているアカウントのログイン名。 */
  viewerLogin(): Promise<Fetched<string>>;
  /** PR のインラインコメント（REST の生の行）。 */
  reviewComments(pr: number): Promise<Fetched<unknown[]>>;
  /** PR のレビュー（REST の生の行）。 */
  reviews(pr: number): Promise<Fetched<unknown[]>>;
  /** 未解決かどうかを含むレビュースレッド。GraphQL を使う任意の操作で、失敗しうる。 */
  reviewThreads(pr: number): Promise<Fetched<ReviewThread[]>>;
}

/** `env` の PATH から gh を探し、`env` を環境変数にして実行する runner を作る。 */
export function createGhRunner(env: Record<string, string | undefined> = process.env): GhRunner {
  return async (args, cwd) => {
    const executable = Bun.which('gh', { PATH: env.PATH ?? '' });
    if (!executable) return { kind: 'not_found' };
    const child = Bun.spawn([executable, ...args], {
      cwd,
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { kind: 'exited', exitCode, stdout, stderr };
  };
}

/** hook のプロセスの環境変数で gh を実行する既定の runner。 */
export const runGh: GhRunner = createGhRunner();

const NEXT_STEP: Record<GitHubUnavailableCause, string> = {
  gh_missing: 'gh をインストールして認証してください。',
  unauthenticated: 'gh auth login で認証するか、GH_TOKEN を設定してください。',
  access_denied: 'トークンの権限とリポジトリへのアクセス権を確認してください。',
  network: 'ネットワークとプロキシの設定を確認し、再実行してください。',
  unknown: '同じ gh api を手で実行して原因を確認してください。',
};

const CAUSE_TEXT: Record<GitHubUnavailableCause, string> = {
  gh_missing: 'gh コマンドが見つかりません',
  unauthenticated: 'gh が GitHub に認証されていません',
  access_denied: 'GitHub がリクエストを拒否しました',
  network: 'GitHub に接続できませんでした',
  unknown: 'gh api が失敗しました',
};

function unavailable(
  cause: GitHubUnavailableCause,
  action: string,
  detail = '',
): GitHubUnavailable {
  const suffix = detail ? `（${detail}）` : '';
  return {
    kind: 'unavailable',
    cause,
    reason: `${action}${/[!-~]$/u.test(action) ? ' ' : ''}を確認できません: ${CAUSE_TEXT[cause]}${suffix}。${NEXT_STEP[cause]}`,
  };
}

/**
 * gh の失敗を種別に分ける。gh は認証が無いとき終了コード 4 を返し、API の拒否は stderr に
 * `HTTP <status>` を出す。判定できない失敗は unknown にする。
 */
export function classifyGhFailure(exitCode: number, stderr: string): GitHubUnavailableCause {
  if (exitCode === 4) return 'unauthenticated';
  if (/HTTP 401|Bad credentials|authentication required|gh auth login|not logged in/iu.test(stderr))
    return 'unauthenticated';
  if (/HTTP 40[34]|forbidden|Resource not accessible|not available from/iu.test(stderr))
    return 'access_denied';
  if (
    /error connecting|dial tcp|could not resolve|no such host|timed? ?out|connection (?:refused|reset)|TLS|proxy|unexpected EOF/iu.test(
      stderr,
    )
  )
    return 'network';
  return 'unknown';
}

/** stderr の最初の空でない行を、理由に添える長さに切る。 */
function firstLine(stderr: string): string {
  const line = stderr.split('\n').find((text) => text.trim() !== '') ?? '';
  return line.trim().slice(0, 200);
}

function failure(outcome: GhOutcome, action: string): GitHubUnavailable {
  if (outcome.kind === 'not_found') return unavailable('gh_missing', action);
  return unavailable(
    classifyGhFailure(outcome.exitCode, outcome.stderr),
    action,
    firstLine(outcome.stderr),
  );
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

interface RepositoryContext {
  host: string;
  owner: string;
  repo: string;
  /**
   * gh に渡す `--hostname <origin のホスト>`。github.com でも省かない。省くと gh は GH_HOST や
   * ログイン済みのホストから問い合わせ先を選び、origin と別のホストを見うるため。
   */
  hostArgs: string[];
  branch: string;
}

async function git(tree: string, args: string[]): Promise<string | null> {
  const child = Bun.spawn(['git', '-C', tree, ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return exitCode === 0 ? stdout.trim() : null;
}

/**
 * PR の head になる origin 側のブランチ名。push 先（`@{push}`）が origin のブランチなら
 * その名前を、そうでなければローカルのブランチ名を使う。追跡先の名前がローカルと違うブランチでも、
 * push される先のブランチで PR を引くため。
 */
async function headBranch(tree: string): Promise<string | null> {
  const local = await git(tree, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!local) return null;
  const push = await git(tree, ['rev-parse', '--symbolic-full-name', '@{push}']);
  const prefix = 'refs/remotes/origin/';
  return push?.startsWith(prefix) ? push.slice(prefix.length) : local;
}

async function resolveRepository(tree: string): Promise<Fetched<RepositoryContext>> {
  const origin = await originRepository(tree);
  if (!origin || origin.host === null)
    return {
      kind: 'unavailable',
      cause: 'unknown',
      reason: `GitHub の対象を決められません: ${tree} の origin から GitHub のリポジトリを読み取れません。origin に GitHub の URL を 1 つだけ設定してください。`,
    };
  const branch = await headBranch(tree);
  if (!branch)
    return {
      kind: 'unavailable',
      cause: 'unknown',
      reason: `GitHub の対象を決められません: ${tree} は特定のブランチにいません（detached HEAD）。PR のブランチをチェックアウトしてから実行してください。`,
    };
  return {
    kind: 'ok',
    value: {
      host: origin.host,
      owner: origin.owner,
      repo: origin.repo,
      hostArgs: ['--hostname', origin.host],
      branch,
    },
  };
}

function isOpenPullRequestRow(
  value: unknown,
): value is { number: number; html_url: string; head: { sha: string }; base?: unknown } {
  return (
    isRecord(value) &&
    typeof value.number === 'number' &&
    Number.isInteger(value.number) &&
    value.number > 0 &&
    typeof value.html_url === 'string' &&
    isRecord(value.head) &&
    typeof value.head.sha === 'string'
  );
}

/** PR の行の base ブランチ名。無ければ null。 */
function baseRefOf(row: { base?: unknown }): string | null {
  return isRecord(row.base) && typeof row.base.ref === 'string' ? row.base.ref : null;
}

/** 作成要求の応答を、照合に要る項目まで読む。形が合わなければ null。 */
function createdPullRequest(value: unknown): CreatedPullRequest | null {
  if (!isOpenPullRequestRow(value)) return null;
  const baseRef = baseRefOf(value);
  if (baseRef === null) return null;
  return { number: value.number, url: value.html_url, headSha: value.head.sha, baseRef };
}

const THREAD_QUERY = `query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    reviewThreads(first:100, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ id isResolved path line
        comments(last:1){ nodes{ databaseId author{ login } body } }
        firstComment: comments(first:1){ nodes{ author{ login } body } }
      }
    }
  } }
}`;

function isAuthor(value: unknown): value is { login: string } | null {
  return value === null || (isRecord(value) && typeof value.login === 'string');
}

function isThread(value: unknown): value is ReviewThread {
  if (!isRecord(value)) return false;
  const { comments, firstComment } = value;
  return (
    typeof value.id === 'string' &&
    typeof value.isResolved === 'boolean' &&
    typeof value.path === 'string' &&
    (value.line === null || typeof value.line === 'number') &&
    isRecord(comments) &&
    Array.isArray(comments.nodes) &&
    comments.nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.databaseId === 'number' &&
        isAuthor(node.author) &&
        typeof node.body === 'string',
    ) &&
    isRecord(firstComment) &&
    Array.isArray(firstComment.nodes) &&
    firstComment.nodes.every(
      (node) => isRecord(node) && isAuthor(node.author) && typeof node.body === 'string',
    )
  );
}

/** 1 ページ分の reviewThreads。形が合わなければ null。 */
function threadPage(payload: unknown): { nodes: ReviewThread[]; next: string | null } | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const repository = payload.data.repository;
  if (!isRecord(repository) || !isRecord(repository.pullRequest)) return null;
  const page = repository.pullRequest.reviewThreads;
  if (!isRecord(page) || !Array.isArray(page.nodes) || !page.nodes.every(isThread)) return null;
  const info = page.pageInfo;
  const next =
    isRecord(info) && info.hasNextPage === true && typeof info.endCursor === 'string'
      ? info.endCursor
      : null;
  return { nodes: page.nodes, next };
}

/** 最初の呼び出しの Promise を使い回す。 */
function lazy<V>(load: () => Promise<V>): () => Promise<V> {
  let pending: Promise<V> | undefined;
  return () => (pending ??= load());
}

/** 引数ごとに最初の呼び出しの Promise を使い回す。 */
function memoize<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = load(key);
    cache.set(key, pending);
    return pending;
  };
}

/**
 * `tree` のチェックアウトを対象にする Port を作る。同じ Port で同じ操作を繰り返し呼んでも
 * GitHub への問い合わせは 1 回にまとめる（1 回の hook 実行の中で、複数の判定が同じ PR を見るため）。
 */
export function createGitHubPort(tree: string, runner: GhRunner = runGh): GitHubPort {
  const repository = lazy(() => resolveRepository(tree));

  async function restPages(
    context: RepositoryContext,
    path: string,
    action: string,
  ): Promise<Fetched<unknown[]>> {
    const outcome = await runner(
      [
        'api',
        `repos/${context.owner}/${context.repo}/${path}`,
        '--paginate',
        '--slurp',
        ...context.hostArgs,
      ],
      tree,
    );
    if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return failure(outcome, action);
    const pages = parseJson(outcome.stdout);
    if (!Array.isArray(pages) || !pages.every(Array.isArray))
      return unavailable('unknown', action, 'gh api の応答を一覧として読めません');
    return { kind: 'ok', value: pages.flat() };
  }

  const port: GitHubPort = {
    target: lazy(async (): Promise<Fetched<RepositoryTarget>> => {
      const resolved = await repository();
      if (resolved.kind !== 'ok') return resolved;
      const { host, owner, repo, branch } = resolved.value;
      return { kind: 'ok', value: { host, owner, repo, branch } };
    }),

    createPullRequest: async (request): Promise<Fetched<CreatedPullRequest>> => {
      const resolved = await repository();
      if (resolved.kind !== 'ok') return resolved;
      const context = resolved.value;
      const action = `${context.owner}/${context.repo} への PR の作成結果`;
      // 本文は引数に載せずファイルから渡す。`-f`/`-F` は値の先頭の `@` をファイル参照として読むなど
      // 本文の内容で解釈が変わるので、要求全体を JSON にして --input で渡す。
      const directory = await mkdtemp(join(tmpdir(), 'gh-create-pr-'));
      const input = join(directory, 'request.json');
      const outcome = await writeFile(input, JSON.stringify(request))
        .then(() =>
          runner(
            [
              'api',
              `repos/${context.owner}/${context.repo}/pulls`,
              '-X',
              'POST',
              '--input',
              input,
              ...context.hostArgs,
            ],
            tree,
          ),
        )
        .finally(() => rm(directory, { recursive: true, force: true }));
      if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return failure(outcome, action);
      const created = createdPullRequest(parseJson(outcome.stdout));
      if (!created)
        return unavailable(
          'unknown',
          action,
          'PR の番号・URL・head・base を応答から読み取れません',
        );
      return { kind: 'ok', value: created };
    },

    probeRest: lazy(async (): Promise<Fetched<string>> => {
      const resolved = await repository();
      if (resolved.kind !== 'ok') return resolved;
      const context = resolved.value;
      const action = `REST での ${context.owner}/${context.repo} の参照`;
      const outcome = await runner(
        [
          'api',
          `repos/${context.owner}/${context.repo}`,
          '--jq',
          '.full_name',
          ...context.hostArgs,
        ],
        tree,
      );
      if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return failure(outcome, action);
      const name = outcome.stdout.trim();
      if (!name) return unavailable('unknown', action, 'リポジトリ名を応答から読み取れません');
      return { kind: 'ok', value: name };
    }),

    probeGraphql: lazy(async (): Promise<Fetched<string>> => {
      const resolved = await repository();
      const hostArgs = resolved.kind === 'ok' ? resolved.value.hostArgs : [];
      const action = 'GraphQL の問い合わせ';
      const outcome = await runner(
        [
          'api',
          'graphql',
          '-f',
          'query=query{viewer{login}}',
          '--jq',
          '.data.viewer.login',
          ...hostArgs,
        ],
        tree,
      );
      if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return failure(outcome, action);
      const login = outcome.stdout.trim();
      if (!login) return unavailable('unknown', action, 'ログイン名を応答から読み取れません');
      return { kind: 'ok', value: login };
    }),

    findOpenPullRequest: lazy(async (): Promise<PullRequestLookup> => {
      const resolved = await repository();
      if (resolved.kind !== 'ok') return resolved;
      const context = resolved.value;
      const action = `${context.owner}/${context.repo} のブランチ ${context.branch} の PR`;
      const head = encodeURIComponent(`${context.owner}:${context.branch}`);
      const outcome = await runner(
        [
          'api',
          `repos/${context.owner}/${context.repo}/pulls?head=${head}&state=open&per_page=100`,
          ...context.hostArgs,
        ],
        tree,
      );
      if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return failure(outcome, action);
      const rows = parseJson(outcome.stdout);
      if (!Array.isArray(rows))
        return unavailable('unknown', action, 'gh api の応答を PR の一覧として読めません');
      // GitHub は作成日時の新しい順に返す。同じ head から複数の base へ PR があれば、最新を対象にする。
      const [first] = rows;
      if (first === undefined) return { kind: 'no_pr' };
      if (!isOpenPullRequestRow(first))
        return unavailable('unknown', action, 'PR の番号・head・URL を読み取れません');
      return {
        kind: 'found',
        pullRequest: {
          number: first.number,
          headSha: first.head.sha,
          baseRef: baseRefOf(first),
          url: first.html_url,
          repository: `${context.owner}/${context.repo}`,
        },
      };
    }),

    viewerLogin: lazy(async (): Promise<Fetched<string>> => {
      const resolved = await repository();
      const hostArgs = resolved.kind === 'ok' ? resolved.value.hostArgs : [];
      const action = 'GitHub のログイン名';
      const user = await runner(['api', 'user', '--jq', '.login', ...hostArgs], tree);
      if (user.kind === 'exited' && user.exitCode === 0 && user.stdout.trim())
        return { kind: 'ok', value: user.stdout.trim() };
      if (user.kind === 'not_found') return failure(user, action);
      // `/user` を読めないトークン（連携アプリのトークンなど）でも、gh auth status はアカウント名を示す。
      const status = await runner(['auth', 'status', ...hostArgs], tree);
      if (status.kind === 'exited') {
        const match = /account\s+([A-Za-z0-9_.\-[\]]+)/iu.exec(status.stdout + status.stderr);
        if (match?.[1]) return { kind: 'ok', value: match[1] };
      }
      return failure(user, action);
    }),

    reviewComments: memoize(async (pr: number): Promise<Fetched<unknown[]>> => {
      const resolved = await repository();
      if (resolved.kind !== 'ok') return resolved;
      return restPages(
        resolved.value,
        `pulls/${pr}/comments?per_page=100`,
        `PR #${pr} のインラインコメント`,
      );
    }),

    reviews: memoize(async (pr: number): Promise<Fetched<unknown[]>> => {
      const resolved = await repository();
      if (resolved.kind !== 'ok') return resolved;
      return restPages(resolved.value, `pulls/${pr}/reviews?per_page=100`, `PR #${pr} のレビュー`);
    }),

    reviewThreads: memoize(async (pr: number): Promise<Fetched<ReviewThread[]>> => {
      const resolved = await repository();
      if (resolved.kind !== 'ok') return resolved;
      const context = resolved.value;
      const action = `PR #${pr} の未解決スレッド`;
      const threads: ReviewThread[] = [];
      // 100 件を超える PR ではスレッドが複数ページに分かれる。1 ページだけ見て対応待ちが無いと
      // 判定すると、後続ページの未解決スレッドを見逃す。
      let after: string | null = null;
      for (;;) {
        const args = [
          'api',
          'graphql',
          '-f',
          `query=${THREAD_QUERY}`,
          '-f',
          `owner=${context.owner}`,
          '-f',
          `name=${context.repo}`,
          '-F',
          `number=${pr}`,
          ...context.hostArgs,
        ];
        if (after) args.push('-f', `after=${after}`);
        const outcome = await runner(args, tree);
        if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return failure(outcome, action);
        const page = threadPage(parseJson(outcome.stdout));
        if (!page) return unavailable('unknown', action, 'GraphQL の応答を読み取れません');
        threads.push(...page.nodes);
        if (!page.next) return { kind: 'ok', value: threads };
        after = page.next;
      }
    }),
  };
  return port;
}
