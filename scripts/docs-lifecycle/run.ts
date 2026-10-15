#!/usr/bin/env bun

import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('.', import.meta.url));
const [mode, ...rest] = process.argv.slice(2);

// 子プロセスも自分と同じ bun で動かす。PATH 上の `bun` は別の (古い) インストールを
// 指しうるので、名前で起動すると下のバージョン確認が実際に走る実体と食い違う。
const bun = process.execPath;

// bun.lock は lockfileVersion 2 で、これを読めない bun は install 段階で
// `Unknown lockfile version` として落ちる。frozen install がそのまま失敗するため
// 依存解決の問題に見え、実際の原因 (bun が古い) に辿り着けない。先に確かめて
// 何を直せばよいかを直接伝える。
// 必要なバージョンの SSOT は package.json の packageManager。
const manifest = (await Bun.file(new URL('package.json', import.meta.url)).json()) as {
  packageManager?: string;
};
// corepack 形式の `bun@1.4.0+sha512...` や canary の suffix も同じ数値要件として扱う。
const requiredBun = /^bun@(\d+\.\d+\.\d+)(?:[-+].*)?$/.exec(manifest.packageManager ?? '')?.[1];

// 数値部分だけを比べる。canary の suffix は無視して、同じ数値なら満たすものとして扱う。
const toNumbers = (version: string) =>
  version
    .split('-', 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

const isOlder = (actual: string, required: string) => {
  const [a, b] = [toNumbers(actual), toNumbers(required)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
};

if (requiredBun !== undefined && isOlder(Bun.version, requiredBun)) {
  process.stderr.write(
    `docs-lifecycle は bun ${requiredBun} 以上を必要とします (実行中: ${Bun.version})。\n` +
      `bun.lock が lockfileVersion 2 で、これより古い bun は読めません。\n` +
      `bun を更新するか、必要な bun を用意して実行する \`mise run lint-docs\` を使ってください。\n`,
  );
  process.exit(1);
}

// Bun の runtime auto-install は package.json がある複数ファイル構成で解決条件が
// 実行元に左右される。毎回 frozen install を確認すれば、同期先の構成に依存せず、
// lockfile と node_modules の不一致も本体を動かす前に修復できる。
const install = Bun.spawnSync([bun, 'install', '--frozen-lockfile'], {
  cwd: packageDir,
  stdin: 'inherit',
  // cli.ts の --json は stdout 全体を機械可読に保つ必要がある。install の通常ログは
  // 捨て、失敗時だけ診断情報を stderr へ転送する。
  stdout: 'pipe',
  stderr: 'pipe',
});
if (install.exitCode !== 0) {
  process.stderr.write(install.stdout);
  process.stderr.write(install.stderr);
  process.exit(install.exitCode);
}

const command =
  mode === 'test'
    ? [bun, 'test', ...rest]
    : [bun, 'run', 'cli.ts', ...(mode === undefined ? [] : [mode]), ...rest];

const child = Bun.spawn(command, {
  cwd: packageDir,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await child.exited);
