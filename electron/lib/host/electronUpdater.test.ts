import type { UpdateCheckResult } from 'electron-updater';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../logger';
import {
  type AutoUpdaterSource,
  canAutoInstallUpdates,
  createElectronUpdater,
  FORCE_QUIT_AFTER_INSTALL_MS,
} from './electronUpdater';

type Listener = (...args: unknown[]) => void;

/** 処理本体の終了を待たず、強制終了の待ちも走らせない偽物 */
const noPrepare = {
  prepareQuit: async () => {},
  forceQuit: () => {},
  schedule: () => {},
};

/** イベントの購読を記録し、テストからイベントを起こせる偽物の autoUpdater */
const createFakeAutoUpdater = () => {
  const listeners = new Map<string, Listener>();
  const fake = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: (event: string, listener: Listener) => {
      listeners.set(event, listener);
      return fake;
    },
    checkForUpdates: vi.fn<() => Promise<UpdateCheckResult | null>>(),
    quitAndInstall: vi.fn(),
  };
  return {
    fake,
    autoUpdater: fake as unknown as AutoUpdaterSource,
    emit: (event: string, ...args: unknown[]) =>
      listeners.get(event)?.(...args),
  };
};

describe('canAutoInstallUpdates', () => {
  it('macOS では自動インストールできない', () => {
    expect(canAutoInstallUpdates('darwin')).toBe(false);
  });

  it('Windows / Linux では自動インストールできる', () => {
    expect(canAutoInstallUpdates('win32')).toBe(true);
    expect(canAutoInstallUpdates('linux')).toBe(true);
  });
});

describe('createElectronUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('自動インストールできない場合は自動ダウンロードと終了時インストールを無効にする', async () => {
    const { fake, autoUpdater } = createFakeAutoUpdater();
    const updater = createElectronUpdater(autoUpdater, noPrepare, false);

    expect(fake.autoDownload).toBe(false);
    expect(fake.autoInstallOnAppQuit).toBe(false);
    expect((await updater.getStatus()).canAutoInstall).toBe(false);
  });

  it('自動インストールできる場合は自動ダウンロードと終了時インストールを有効にする', async () => {
    const { fake, autoUpdater } = createFakeAutoUpdater();
    const updater = createElectronUpdater(autoUpdater, noPrepare, true);

    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(true);
    expect((await updater.getStatus()).canAutoInstall).toBe(true);
  });

  it('update-available を受けると利用可能なバージョンを保持する', async () => {
    const { autoUpdater, emit } = createFakeAutoUpdater();
    const updater = createElectronUpdater(autoUpdater, noPrepare, false);
    expect((await updater.getStatus()).availableVersion).toBeNull();

    emit('update-available', { version: '1.2.3' });

    expect((await updater.getStatus()).availableVersion).toBe('1.2.3');
  });

  it('update-downloaded を受けるとダウンロード済みになる', async () => {
    const { autoUpdater, emit } = createFakeAutoUpdater();
    const updater = createElectronUpdater(autoUpdater, noPrepare, true);

    emit('update-downloaded');

    expect((await updater.getStatus()).updateDownloaded).toBe(true);
  });

  it('error を受けるとログに残す', async () => {
    const { autoUpdater, emit } = createFakeAutoUpdater();
    const updater = createElectronUpdater(autoUpdater, noPrepare, true);

    emit('error', new Error('download failed'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('download failed'),
    );
    expect((await updater.getStatus()).updateDownloaded).toBe(false);
  });

  it('確認結果から、プロセスの間で受け渡せる値だけを返す', async () => {
    const { fake, autoUpdater } = createFakeAutoUpdater();
    const updateInfo = {
      version: '2.0.0',
      releaseDate: '2026-01-01T00:00:00.000Z',
      releaseName: 'v2.0.0',
      releaseNotes: 'notes',
      files: [],
      path: 'app.exe',
      sha512: 'hash',
    };
    fake.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo,
      versionInfo: updateInfo,
      downloadPromise: Promise.resolve([]),
    });
    const updater = createElectronUpdater(autoUpdater, noPrepare, true);

    await expect(updater.checkForUpdates()).resolves.toEqual({
      isUpdateAvailable: true,
      updateInfo: {
        version: '2.0.0',
        releaseDate: '2026-01-01T00:00:00.000Z',
        releaseName: 'v2.0.0',
        releaseNotes: 'notes',
      },
    });
  });

  it('更新の仕組みが動かない環境では null を返す', async () => {
    const { fake, autoUpdater } = createFakeAutoUpdater();
    fake.checkForUpdates.mockResolvedValue(null);
    const updater = createElectronUpdater(autoUpdater, noPrepare, true);

    await expect(updater.checkForUpdates()).resolves.toBeNull();
  });

  it('quitAndInstall は autoUpdater の quitAndInstall を呼ぶ', async () => {
    const { fake, autoUpdater } = createFakeAutoUpdater();
    const updater = createElectronUpdater(autoUpdater, noPrepare, true);

    await updater.quitAndInstall();

    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('quitAndInstall は処理本体の終了を待ってから autoUpdater に渡す', async () => {
    const { fake, autoUpdater } = createFakeAutoUpdater();
    const order: string[] = [];
    let finishPrepare: () => void = () => {};
    const prepareQuit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('prepare');
          finishPrepare = () => {
            order.push('prepared');
            resolve();
          };
        }),
    );
    fake.quitAndInstall.mockImplementation(() => {
      order.push('quitAndInstall');
    });
    const updater = createElectronUpdater(
      autoUpdater,
      { ...noPrepare, prepareQuit },
      true,
    );

    const installing = updater.quitAndInstall();
    await Promise.resolve();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    finishPrepare();
    await installing;

    expect(order).toEqual(['prepare', 'prepared', 'quitAndInstall']);
  });

  describe('インストーラを起動できなかったとき', () => {
    /** 待ちを記録し、テストから呼び出せる schedule */
    const createSchedule = () => {
      const scheduled: { callback: () => void; delayMs: number }[] = [];
      return {
        scheduled,
        schedule: (callback: () => void, delayMs: number) => {
          scheduled.push({ callback, delayMs });
        },
      };
    };

    it('待ちの上限を過ぎてもアプリが残っていれば、アプリを終える', async () => {
      const { autoUpdater } = createFakeAutoUpdater();
      const forceQuit = vi.fn();
      const { scheduled, schedule } = createSchedule();
      const updater = createElectronUpdater(
        autoUpdater,
        { ...noPrepare, forceQuit, schedule },
        true,
      );

      await updater.quitAndInstall();
      expect(forceQuit).not.toHaveBeenCalled();
      expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([
        FORCE_QUIT_AFTER_INSTALL_MS,
      ]);

      scheduled[0]?.callback();
      expect(forceQuit).toHaveBeenCalledTimes(1);
    });

    it('インストールを渡した後に error が届いたら、待たずにアプリを終える', async () => {
      const { autoUpdater, emit } = createFakeAutoUpdater();
      const forceQuit = vi.fn();
      const updater = createElectronUpdater(
        autoUpdater,
        { ...noPrepare, forceQuit },
        true,
      );

      await updater.quitAndInstall();
      emit('error', new Error('installer not found'));

      expect(forceQuit).toHaveBeenCalledTimes(1);
    });

    it('インストールを頼む前の error（更新の確認の失敗など）ではアプリを終えない', () => {
      const { autoUpdater, emit } = createFakeAutoUpdater();
      const forceQuit = vi.fn();
      createElectronUpdater(autoUpdater, { ...noPrepare, forceQuit }, true);

      emit('error', new Error('network down'));

      expect(forceQuit).not.toHaveBeenCalled();
    });
  });
});
