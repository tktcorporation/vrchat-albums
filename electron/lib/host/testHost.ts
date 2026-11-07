import * as os from 'node:os';
import * as path from 'node:path';

import type { Host, HostInfo, HostPaths, HostShell } from './types';

/**
 * テストで差し替えたい部分だけを渡すための型。
 * `paths` は 1 項目ずつ上書きでき、残りは既定の一時ディレクトリを使う。
 */
export interface TestHostOverrides {
  readonly paths?: Partial<HostPaths>;
  readonly info?: Partial<Omit<HostInfo, 'paths'>>;
  readonly shell?: Partial<HostShell>;
}

/**
 * テスト用の殻の既定のディレクトリ。
 * 実機のユーザーデータを汚さないよう、すべて `os.tmpdir()` 配下に置く。
 * userData は、テストが既に前提にしている `vrchat-albums-test-user-data` を使う。
 */
const createDefaultTestPaths = (): HostPaths => {
  const tmp = os.tmpdir();
  return {
    userData: path.join(tmp, 'vrchat-albums-test-user-data'),
    downloads: path.join(tmp, 'vrchat-albums-test-downloads'),
    pictures: path.join(tmp, 'vrchat-albums-test-pictures'),
    temp: tmp,
  };
};

/**
 * OS に触れず、何もせずに解決する既定の操作。
 * 呼び出しを検証したいテストは `overrides.shell` に `vi.fn()` を渡す。
 */
const createNoopTestShell = (): HostShell => ({
  openPath: async () => '',
  openExternal: async () => {},
  showOpenDialog: async () => ({ canceled: true }),
  showSaveDialog: async () => ({ canceled: true }),
  writeClipboardImageFromPngFile: async () => {},
  writeClipboardText: async () => {},
  notify: async () => {},
  getOpenAtLogin: async () => false,
  setOpenAtLogin: async () => {},
});

/**
 * テストで登録する殻の実装。
 *
 * `vitest.setup.ts` が既定値で登録し、electron/ のどのテストでも `getHost()` が使えるようにする。
 * 個別の値や操作を確かめたいテストは `registerHost(createTestHost({...}))` で登録し直す。
 */
export const createTestHost = (overrides: TestHostOverrides = {}): Host => ({
  info: {
    paths: { ...createDefaultTestPaths(), ...overrides.paths },
    appVersion: process.env.npm_package_version ?? '0.0.0-test',
    isPackaged: false,
    // 開発時と同じく、ソースの electron/resources を同梱リソースとして読む
    resourcesPath: path.join(__dirname, '../../resources'),
    ...overrides.info,
  },
  shell: { ...createNoopTestShell(), ...overrides.shell },
});
