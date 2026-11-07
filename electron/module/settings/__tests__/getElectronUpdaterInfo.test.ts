import { Cause, Effect, Exit, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { type HostUpdateCheckResult, registerHost } from '../../../lib/host';
import { createTestHost } from '../../../lib/host/testHost';
import { UpdateCheckFailed } from '../errors';
import { getElectronUpdaterInfo } from '../service';

const checkResult = (version: string): HostUpdateCheckResult => ({
  isUpdateAvailable: true,
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

  it('配布元の版が動いている版と違えば更新ありとし、確認結果を添える', async () => {
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

  it('配布元の版が動いている版と同じなら更新なしとする', async () => {
    registerHost(
      createTestHost({
        info: { appVersion: '2.0.0' },
        updater: { checkForUpdates: async () => checkResult('2.0.0') },
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
