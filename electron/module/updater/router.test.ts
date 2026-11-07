import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { type HostUpdater, registerHost } from '../../lib/host';
import { createTestHost } from '../../lib/host/testHost';
import { logger } from '../../lib/logger';
import { updaterRouter } from './router';

const caller = updaterRouter.createCaller({
  eventEmitter: new EventEmitter(),
});

describe('updaterRouter', () => {
  afterEach(() => {
    registerHost(createTestHost());
    vi.clearAllMocks();
  });

  it('getUpdateStatus は殻の更新の状態を返す', async () => {
    registerHost(
      createTestHost({
        updater: {
          getStatus: async () => ({
            updateDownloaded: true,
            availableVersion: '1.2.3',
            canAutoInstall: true,
          }),
        },
      }),
    );

    await expect(caller.getUpdateStatus()).resolves.toEqual({
      updateDownloaded: true,
      availableVersion: '1.2.3',
      canAutoInstall: true,
    });
  });

  it('checkForUpdates は確認の失敗をログに残し、呼び出し側へはエラーを返さない', async () => {
    const checkForUpdates = vi.fn<HostUpdater['checkForUpdates']>(async () => {
      throw new Error('network down');
    });
    registerHost(createTestHost({ updater: { checkForUpdates } }));

    await expect(caller.checkForUpdates()).resolves.toBeUndefined();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('network down'),
    );
  });

  it('quitAndInstall は殻の quitAndInstall を呼ぶ', async () => {
    const quitAndInstall = vi.fn<HostUpdater['quitAndInstall']>(async () => {});
    registerHost(createTestHost({ updater: { quitAndInstall } }));

    await caller.quitAndInstall();

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
