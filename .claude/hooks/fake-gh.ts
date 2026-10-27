/**
 * テスト用の偽 gh。実行環境ごとに GitHub へ届く操作が違うので、能力プロファイルで再現する。
 *
 * - full: GraphQL も REST も通る
 * - rest-only: GraphQL を使う操作（`gh api graphql`・`gh pr`・`gh repo`）を 403 で拒否し、REST だけを通す
 * - unauthenticated: すべての操作が認証エラーになる
 *
 * gh そのものが無い環境は、偽 gh を置かずに pathWithoutGh() の PATH で再現する。
 *
 * 応答は環境変数で渡す（テストごとに同じスクリプトを使い回せるように）。
 * - FAKE_GH_PROFILE: 上のプロファイル。既定は full
 * - FAKE_GH_PULLS: `repos/<owner>/<repo>/pulls?head=...` への応答（JSON 配列）。既定は `[]`
 * - FAKE_GH_CREATED: `repos/<owner>/<repo>/pulls` への POST の応答（JSON）。既定は 404 で失敗する
 * - FAKE_GH_CREATE_ERROR: 1 なら POST を応答の途絶（通信エラー）で失敗させる。要求は届いた扱い
 * - FAKE_GH_CREATE_MARK: 設定すると、POST を受けた時点でこのファイルを作る。作られた後の PR の
 *   検索は FAKE_GH_PULLS_AFTER_CREATE（既定は FAKE_GH_PULLS）を返す
 * - FAKE_GH_CREATE_INPUT: 設定すると、POST の `--input` の中身をこのファイルへ写す
 * - FAKE_GH_LOGIN: `gh api user` が返すログイン名。既定は testuser
 * - FAKE_COMMENTS / FAKE_REVIEWS: `--paginate --slurp` の応答（ページの配列）。既定は `[[]]`
 * - FAKE_GH_THREADS: `gh api graphql` が返す reviewThreads の nodes（JSON 配列）。既定は `[]`
 * - FAKE_PR_ERROR: 1 なら PR の検索を通信エラーで失敗させる
 * - FAKE_TARGET: 設定すると、そのディレクトリ以外から呼ばれた PR の検索は PR なしを返す
 * - FAKE_GH_LOG: 設定すると、呼び出しの引数を 1 行ずつ追記する
 */
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

export type GhProfile = 'full' | 'rest-only' | 'unauthenticated';

export const GRAPHQL_DENIED =
  'HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API (gh api repos/{owner}/{repo}/...).';

const SCRIPT = `#!/bin/sh
[ -n "$FAKE_GH_LOG" ] && printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
profile="\${FAKE_GH_PROFILE:-full}"
if [ "$profile" = "unauthenticated" ]; then
  echo 'HTTP 401: Bad credentials (https://api.github.com/user)' >&2
  echo 'To get started with GitHub CLI, please run:  gh auth login' >&2
  exit 1
fi
if [ "$1" = "pr" ] || [ "$1" = "repo" ] || { [ "$1" = "api" ] && [ "$2" = "graphql" ]; }; then
  if [ "$profile" = "rest-only" ]; then
    echo '${GRAPHQL_DENIED}' >&2
    exit 1
  fi
fi
if [ "$1" = "auth" ]; then
  echo "  Logged in to github.com account \${FAKE_GH_LOGIN:-testuser} (GH_TOKEN)" >&2
  exit 0
fi
if [ "$1" != "api" ]; then
  echo "fake gh: unsupported command: $*" >&2
  exit 1
fi
case "$2" in
  user) printf '%s\\n' "\${FAKE_GH_LOGIN:-testuser}" ;;
  graphql)
    case "$*" in
      *'viewer{login}'*) printf '%s\\n' "\${FAKE_GH_LOGIN:-testuser}"; exit 0 ;;
    esac
    printf '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":%s,"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}\\n' "\${FAKE_GH_THREADS:-[]}" ;;
  repos/*/pulls\\?head=*)
    if [ "$FAKE_PR_ERROR" = "1" ]; then echo 'error connecting to api.github.com' >&2; exit 1; fi
    if [ -n "$FAKE_TARGET" ] && [ "$PWD" != "$FAKE_TARGET" ]; then printf '[]\\n'; exit 0; fi
    if [ -n "$FAKE_GH_CREATE_MARK" ] && [ -f "$FAKE_GH_CREATE_MARK" ]; then
      printf '%s\\n' "\${FAKE_GH_PULLS_AFTER_CREATE:-\${FAKE_GH_PULLS:-[]}}"; exit 0
    fi
    printf '%s\\n' "\${FAKE_GH_PULLS:-[]}" ;;
  repos/*/*/pulls)
    input=''
    previous=''
    for arg; do [ "$previous" = "--input" ] && input=$arg; previous=$arg; done
    [ -n "$FAKE_GH_CREATE_INPUT" ] && [ -n "$input" ] && cp "$input" "$FAKE_GH_CREATE_INPUT"
    [ -n "$FAKE_GH_CREATE_MARK" ] && : > "$FAKE_GH_CREATE_MARK"
    if [ "$FAKE_GH_CREATE_ERROR" = "1" ]; then echo 'unexpected EOF' >&2; exit 1; fi
    if [ -z "$FAKE_GH_CREATED" ]; then echo "HTTP 404: Not Found ($2)" >&2; exit 1; fi
    printf '%s\\n' "$FAKE_GH_CREATED" ;;
  */reviews\\?*) printf '%s\\n' "\${FAKE_REVIEWS:-[[]]}" ;;
  */comments\\?*) printf '%s\\n' "\${FAKE_COMMENTS:-[[]]}" ;;
  *)
    # repos/<owner>/<repo> そのもの（リポジトリの参照）だけを通し、それ以外のパスは 404 にする。
    case "\${2#repos/}" in
      "$2"|*/*/*|*\\?*) echo "HTTP 404: Not Found ($2)" >&2; exit 1 ;;
      */*) printf '%s\\n' "\${2#repos/}" ;;
      *) echo "HTTP 404: Not Found ($2)" >&2; exit 1 ;;
    esac ;;
esac
`;

/** `bin/gh` に偽 gh を書く。PATH の先頭に `bin` を置いて使う。 */
export async function writeFakeGh(bin: string): Promise<void> {
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'gh'), SCRIPT, { mode: 0o755 });
}

/** REST が返す PR 1 件の行。 */
export function pullRow(
  number: number,
  headSha = '',
  baseRef = 'main',
  repository = 'owner/repo',
): Record<string, unknown> {
  return {
    number,
    html_url: `https://github.com/${repository}/pull/${number}`,
    head: { sha: headSha },
    base: { ref: baseRef },
  };
}

/** 偽 gh の FAKE_GH_PULLS に渡す、open な PR 1 件の REST 応答。 */
export function pullsPayload(number: number, headSha = '', repository = 'owner/repo'): string {
  return JSON.stringify([pullRow(number, headSha, 'main', repository)]);
}

/**
 * 現在の PATH から gh だけを除いた PATH を `dir` に作る。PATH の各ディレクトリの実行ファイルへの
 * シンボリックリンクを 1 か所に集めるので、gh と同じディレクトリにある git や bun は残る。
 */
export async function pathWithoutGh(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const seen = new Set<string>(['gh']);
  for (const source of (process.env.PATH ?? '').split(delimiter)) {
    if (!source) continue;
    const names = await readdir(source).catch(() => []);
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      await symlink(join(source, name), join(dir, name)).catch(() => undefined);
    }
  }
  return dir;
}
