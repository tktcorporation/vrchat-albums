import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { logger } from '../logger';
import {
  createElectronHostInfo,
  createElectronHostShell,
} from './electronHost';

type PathName = Parameters<
  Parameters<typeof createElectronHostInfo>[0]['getPath']
>[0];

/** `getPath` が `failing` に挙げた名前で例外を投げる偽物の app */
const createFakeApp = (failing: readonly PathName[], isPackaged = false) => ({
  getPath: (name: PathName) => {
    if (failing.includes(name)) {
      throw new Error(`Failed to get '${name}' path`);
    }
    return `/os/${name}`;
  },
  getVersion: () => '1.2.3',
  getAppPath: () => '/repo',
  isPackaged,
});

describe('createElectronHostInfo', () => {
  it('app.getPath の値をそのまま使う', () => {
    const info = createElectronHostInfo(createFakeApp([]));

    expect(info.paths).toEqual({
      userData: '/os/userData',
      logs: '/os/logs',
      downloads: '/os/downloads',
      pictures: '/os/pictures',
      temp: '/os/temp',
    });
    expect(info.appVersion).toBe('1.2.3');
  });

  it('downloads・pictures・temp が読めなければ既定の場所へ倒し、警告を残す', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const info = createElectronHostInfo(
      createFakeApp(['downloads', 'pictures', 'temp']),
    );

    expect(info.paths.userData).toBe('/os/userData');
    expect(info.paths.downloads).toBe(process.cwd());
    expect(info.paths.pictures).toBe(
      path.join(process.env.USERPROFILE ?? os.homedir(), 'Pictures'),
    );
    expect(info.paths.temp).toBe(os.tmpdir());
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('userData が読めなければ起動を止める', () => {
    expect(() => createElectronHostInfo(createFakeApp(['userData']))).toThrow(
      "Failed to get 'userData' path",
    );
  });

  it('開発時はリポジトリの electron/resources、パッケージ時は process.resourcesPath を同梱リソースにする', () => {
    expect(createElectronHostInfo(createFakeApp([])).resourcesPath).toBe(
      path.join('/repo', 'electron', 'resources'),
    );
    // Node で動くテストには Electron が足す process.resourcesPath が無いので、仮の値を置く
    Object.defineProperty(process, 'resourcesPath', {
      value: '/packaged/resources',
      configurable: true,
    });
    expect(createElectronHostInfo(createFakeApp([], true)).resourcesPath).toBe(
      '/packaged/resources',
    );
    Reflect.deleteProperty(process, 'resourcesPath');
  });
});

describe('createElectronHostShell', () => {
  it('ウィンドウの再読み込みと規約への同意を、登録時に受け取った関数へ渡す', async () => {
    const reloadWindow = vi.fn();
    const onTermsAccepted = vi.fn();
    const shell = createElectronHostShell({
      reloadWindow,
      onTermsAccepted,
    });

    await shell.reloadWindow();
    expect(reloadWindow).toHaveBeenCalledTimes(1);
    expect(onTermsAccepted).not.toHaveBeenCalled();

    await shell.onTermsAccepted();
    expect(onTermsAccepted).toHaveBeenCalledTimes(1);
  });
});
