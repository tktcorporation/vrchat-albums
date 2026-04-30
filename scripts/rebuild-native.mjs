#!/usr/bin/env node
/**
 * postinstall から呼ばれる native module rebuild。
 *
 * SKIP_REBUILD_NATIVE 環境変数が set の場合は no-op で終了する。
 * これは CI の lint job 等、native binding を必要としない job で
 * Rust toolchain なしの環境でも install を成功させるための退避策。
 *
 * 旧実装（`node -e "..." && electron-rebuild ...` の inline）では
 * `&&` の左辺が常に exit 0 になり skip が効かなかった。
 */
import { execFileSync } from 'node:child_process';

if (process.env.SKIP_REBUILD_NATIVE) {
  console.log(
    '[rebuild-native] SKIP_REBUILD_NATIVE set — skipping electron-rebuild',
  );
  process.exit(0);
}

const targets = ['clip-filepaths', '@vrchat-albums/exif-native'];

// Windows の pnpm は `pnpm.cmd` として配布される。Node の execFileSync は
// CreateProcess を直接呼ぶため、`.cmd` ファイルは cmd.exe 経由じゃないと
// 実行できない（"%1 is not a valid Win32 application" 等で失敗）。
// `shell: true` で cmd.exe を介して resolve させる。args は配列のまま渡せる。
const useShell = process.platform === 'win32';

for (const target of targets) {
  console.log(`[rebuild-native] electron-rebuild -w ${target}`);
  execFileSync('pnpm', ['exec', 'electron-rebuild', '-f', '-w', target], {
    stdio: 'inherit',
    shell: useShell,
  });
}
