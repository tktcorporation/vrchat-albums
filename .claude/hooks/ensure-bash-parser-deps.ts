/// <reference types="bun" />
/**
 * @ast-grep/napi・@ast-grep/lang-bash は command-parse.ts の Bash 解析に要るが、
 * ziku の同期が運べるのは .claude/hooks/*.ts のような直下ファイルだけで、
 * package.json や lockfile、依存本体は届かない。同期先リポジトリの root package.json に
 * 依存させると管理が分散するため、このディレクトリ単独で自己完結させる。
 * package.json と bun.lock はこのファイル自身に埋め込み、初回実行時にだけ書き出して
 * `bun install --frozen-lockfile` する（以降は node_modules の有無だけ見て即座に返る）。
 * lockfile も埋め込むのは、@ast-grep/napi の推移的依存（プラットフォーム別バイナリの
 * optionalDependencies 等）まで含めて固定し、同期先やインストール時期によって解決結果が
 * 揺れないようにするため。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const AST_GREP_NAPI_VERSION = '0.45.3';
const AST_GREP_LANG_BASH_VERSION = '0.0.8';

const PACKAGE_JSON =
  JSON.stringify(
    {
      name: '@workspace-template/hooks-runtime',
      private: true,
      dependencies: {
        '@ast-grep/napi': AST_GREP_NAPI_VERSION,
        '@ast-grep/lang-bash': AST_GREP_LANG_BASH_VERSION,
      },
    },
    null,
    2,
  ) + '\n';

// 上のバージョン定数を変えたときは、このディレクトリで
// `rm -rf node_modules package.json bun.lock && bun install` を実行し、
// 生成された bun.lock の中身をこの定数へそのまま貼り直すこと。
const BUN_LOCK = `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "@workspace-template/hooks-runtime",
      "dependencies": {
        "@ast-grep/lang-bash": "0.0.8",
        "@ast-grep/napi": "0.45.3",
      },
    },
  },
  "packages": {
    "@ast-grep/lang-bash": ["@ast-grep/lang-bash@0.0.8", "", { "dependencies": { "@ast-grep/setup-lang": "0.0.6" }, "peerDependencies": { "tree-sitter-cli": "0.25.8" }, "optionalPeers": ["tree-sitter-cli"] }, "sha512-qFykSsOdBv35I1rtt2PstJ4luzV9J1YCiFZBgySI8UPOh+TFnmpdlq9CrryNOj0Q7f6zZhc1OIau+/mUSs6HAg=="],

    "@ast-grep/napi": ["@ast-grep/napi@0.45.3", "", { "optionalDependencies": { "@ast-grep/napi-darwin-arm64": "0.45.3", "@ast-grep/napi-darwin-x64": "0.45.3", "@ast-grep/napi-linux-arm64-gnu": "0.45.3", "@ast-grep/napi-linux-arm64-musl": "0.45.3", "@ast-grep/napi-linux-x64-gnu": "0.45.3", "@ast-grep/napi-linux-x64-musl": "0.45.3", "@ast-grep/napi-win32-arm64-msvc": "0.45.3", "@ast-grep/napi-win32-ia32-msvc": "0.45.3", "@ast-grep/napi-win32-x64-msvc": "0.45.3" } }, "sha512-bjJsUt0g3UCwbn9bjv7MnoR15rszSm79yPCXn4DWWK0NuYUUqBU/srtNMR4WnpfR7TnfBRdYFoqSNx0pGCNWJg=="],

    "@ast-grep/napi-darwin-arm64": ["@ast-grep/napi-darwin-arm64@0.45.3", "", { "os": "darwin", "cpu": "arm64" }, "sha512-rMZJ6frSpR/xSbeV4hiA9WR5hHqk3rVYX8lOqEoUCaUnjEuFXvHdGN4WawJ8pVDq/IqM1UnTtsDSYgUdVmO5DA=="],

    "@ast-grep/napi-darwin-x64": ["@ast-grep/napi-darwin-x64@0.45.3", "", { "os": "darwin", "cpu": "x64" }, "sha512-tIclZ5pM+YSgk8NNTBoTkaclbS39cU5lbVfSrFWX4LUnxXfUPG+F+ppxyFjKwJTBELsGHEO4LdX3/Lc+FDwPNA=="],

    "@ast-grep/napi-linux-arm64-gnu": ["@ast-grep/napi-linux-arm64-gnu@0.45.3", "", { "os": "linux", "cpu": "arm64" }, "sha512-Bm8F7/oRHQkDXbjH+gBi9oB5huJ0q12r/AIOMIypf5PWlAVvh206Tsw468phw4Oh6kd4Ad1Z+gflNW1MutgK2g=="],

    "@ast-grep/napi-linux-arm64-musl": ["@ast-grep/napi-linux-arm64-musl@0.45.3", "", { "os": "linux", "cpu": "arm64" }, "sha512-yr5xcRerV41GeRxmZ8SKbfGeyZRhQePoNNCgTAb4OrWMelWwbMI80aY7/IlF2bo1sN40BSW4hZdGIO/akTd1RQ=="],

    "@ast-grep/napi-linux-x64-gnu": ["@ast-grep/napi-linux-x64-gnu@0.45.3", "", { "os": "linux", "cpu": "x64" }, "sha512-lluRK3hxfHMQdFuVID6seAKVx4FH0kEwF6rCh5/I40Sf3EtNR2UCBXAqd6RBA6hqlSckktvBxCfw+h4aescDmg=="],

    "@ast-grep/napi-linux-x64-musl": ["@ast-grep/napi-linux-x64-musl@0.45.3", "", { "os": "linux", "cpu": "x64" }, "sha512-09wJQKq86LqILqQtw0+X09SzhcPwUnMVFKyia7S3XLbLqSeQpAMF55Y+zll53JRQ1dCzFEZJyvTT/7j9vwfE3w=="],

    "@ast-grep/napi-win32-arm64-msvc": ["@ast-grep/napi-win32-arm64-msvc@0.45.3", "", { "os": "win32", "cpu": "arm64" }, "sha512-/HiVgw2cdtzXLDLoG4eBBcauekNXewfagy7qiVbjkVu/KcCH8dJ9lpj8DzeWwuBNtZxuD8jpiwP0M1pz3Bc3uw=="],

    "@ast-grep/napi-win32-ia32-msvc": ["@ast-grep/napi-win32-ia32-msvc@0.45.3", "", { "os": "win32", "cpu": "ia32" }, "sha512-/gwJrJQUw65uNtAFcG2rtSTr117Gqqy3bfjaljCPKsa65dTeRcMMnjKLlZ6V9/g8z+4Xf78kdhp5ECbir4yfSw=="],

    "@ast-grep/napi-win32-x64-msvc": ["@ast-grep/napi-win32-x64-msvc@0.45.3", "", { "os": "win32", "cpu": "x64" }, "sha512-CEZAMAsaDoQoVE3MT2c/ry3/ydfyaqlTjxv8DK5PG355SrdAYPgevGC2Me6tz4dhphJin89Y20VsnrS5UrYV5Q=="],

    "@ast-grep/setup-lang": ["@ast-grep/setup-lang@0.0.6", "", {}, "sha512-aSYZNF5nGQMxnwiA3Lcc8zi0AtpGlug47ADgqCgP/2n7p922FbnW7vo1rbW4kKjW72B/3mDdN7uvYidv8JnPnw=="],
  }
}
`;

export async function ensureBashParserDeps(hooksDir: string): Promise<void> {
  if (existsSync(join(hooksDir, 'node_modules', '@ast-grep', 'napi'))) return;
  await Bun.write(join(hooksDir, 'package.json'), PACKAGE_JSON);
  await Bun.write(join(hooksDir, 'bun.lock'), BUN_LOCK);
  const install = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
    cwd: hooksDir,
    stdout: 'ignore',
    stderr: 'inherit',
  });
  if (install.exitCode !== 0)
    throw new Error(
      '.claude/hooks の @ast-grep 初回インストールに失敗しました（ネットワーク接続を確認してください）',
    );
}
