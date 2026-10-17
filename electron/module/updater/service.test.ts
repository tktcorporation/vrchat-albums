import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
}));

type Listener = (...args: unknown[]) => void;

const { listeners, mockAutoUpdater } = vi.hoisted(() => {
  const listeners = new Map<string, Listener>();
  const mockAutoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: (event: string, listener: Listener) => {
      listeners.set(event, listener);
      return mockAutoUpdater;
    },
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  return { listeners, mockAutoUpdater };
});

vi.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }));

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../../lib/logger';
import { canAutoInstallUpdates, UpdaterService } from './service';

describe('canAutoInstallUpdates', () => {
  it('macOS では自動インストールできない', () => {
    expect(canAutoInstallUpdates('darwin')).toBe(false);
  });

  it('Windows / Linux では自動インストールできる', () => {
    expect(canAutoInstallUpdates('win32')).toBe(true);
    expect(canAutoInstallUpdates('linux')).toBe(true);
  });
});

describe('UpdaterService', () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
  });

  it('自動インストールできない場合は自動ダウンロードと終了時インストールを無効にする', () => {
    const service = new UpdaterService(false);

    expect(mockAutoUpdater.autoDownload).toBe(false);
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(service.getCanAutoInstall()).toBe(false);
  });

  it('自動インストールできる場合は自動ダウンロードと終了時インストールを有効にする', () => {
    const service = new UpdaterService(true);

    expect(mockAutoUpdater.autoDownload).toBe(true);
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(service.getCanAutoInstall()).toBe(true);
  });

  it('update-available を受けると利用可能なバージョンを保持する', () => {
    const service = new UpdaterService(false);
    expect(service.getAvailableVersion()).toBeNull();

    listeners.get('update-available')?.({ version: '1.2.3' });

    expect(service.getAvailableVersion()).toBe('1.2.3');
  });

  it('update-downloaded を受けるとダウンロード済みになる', () => {
    const service = new UpdaterService(true);

    listeners.get('update-downloaded')?.();

    expect(service.getUpdateDownloaded()).toBe(true);
  });

  it('error を受けるとログに残す', () => {
    const service = new UpdaterService(true);

    listeners.get('error')?.(new Error('download failed'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('download failed'),
    );
    expect(service.getUpdateDownloaded()).toBe(false);
  });
});
