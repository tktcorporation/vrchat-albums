import { Cause, Effect, Exit, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { type HostUpdateCheckResult, registerHost } from '../../../lib/host';
import { createTestHost } from '../../../lib/host/testHost';
import { UpdateCheckFailed } from '../errors';
import { getElectronUpdaterInfo } from '../service';

const checkResult = (
  version: string,
  isUpdateAvailable = true,
): HostUpdateCheckResult => ({
  isUpdateAvailable,
  updateInfo: {
    version,
    releaseDate: '2026-01-01T00:00:00.000Z',
    releaseName: null,
    releaseNotes: null,
  },
});

describe('getElectronUpdaterInfo', () => {
  afterEach(() => {
    registerHost(createTestHost());
  });

  it('electron-updater が更新ありと判定すれば更新ありとし、確認結果を添える', async () => {
    const result = checkResult('2.0.0');
    registerHost(
      createTestHost({
        info: { appVersion: '1.0.0' },
        updater: { checkForUpdates: async () => result },
      }),
    );

    await expect(Effect.runPromise(getElectronUpdaterInfo())).resolves.toEqual({
      isUpdateAvailable: true,
      updateInfo: result,
    });
  });

  it('配布元の版が動いている版と違っても、electron-updater が更新なしと判定すれば更新なしとする', async () => {
    // beta 版を動かしていて、配布元の最新が 1 つ前の安定版のとき
    registerHost(
      createTestHost({
        info: { appVersion: '2.0.0-beta.1' },
        updater: { checkForUpdates: async () => checkResult('1.9.0', false) },
      }),
    );

    const info = await Effect.runPromise(getElectronUpdaterInfo());
    expect(info.isUpdateAvailable).toBe(false);
  });

  it('更新の仕組みが動かない環境では更新なしで確認結果を持たない', async () => {
    await expect(Effect.runPromise(getElectronUpdaterInfo())).resolves.toEqual({
      isUpdateAvailable: false,
      updateInfo: null,
    });
  });

  it('確認に失敗すると UpdateCheckFailed を返す', async () => {
    registerHost(
      createTestHost({
        updater: {
          checkForUpdates: async () => {
            throw new Error('network down');
          },
        },
      }),
    );

    const exit = await Effect.runPromiseExit(getElectronUpdaterInfo());
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
      : undefined;
    expect(error).toBeInstanceOf(UpdateCheckFailed);
    expect(error?.message).toBe('network down');
  });
});
