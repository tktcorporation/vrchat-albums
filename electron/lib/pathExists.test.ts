import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Cause, Effect, Exit, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PathExistenceCheckFailed, pathExistsAsync } from './pathExists';

describe('pathExistsAsync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'path-exists-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('存在するファイルは true を返す', async () => {
    const filePath = path.join(tempDir, 'exists.txt');
    nodeFs.writeFileSync(filePath, 'x');

    await expect(Effect.runPromise(pathExistsAsync(filePath))).resolves.toBe(
      true,
    );
  });

  it('存在するディレクトリは true を返す', async () => {
    await expect(Effect.runPromise(pathExistsAsync(tempDir))).resolves.toBe(
      true,
    );
  });

  it('ENOENT は false を返す', async () => {
    await expect(
      Effect.runPromise(pathExistsAsync(path.join(tempDir, 'missing.txt'))),
    ).resolves.toBe(false);
  });

  it('ENOTDIR（途中がファイル）は false を返す', async () => {
    const filePath = path.join(tempDir, 'file.txt');
    nodeFs.writeFileSync(filePath, 'x');
    vi.spyOn(nodeFs.promises, 'access').mockRejectedValue(
      Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }),
    );

    await expect(
      Effect.runPromise(pathExistsAsync(path.join(filePath, 'child'))),
    ).resolves.toBe(false);
  });

  it('EACCES は PathExistenceCheckFailed で失敗し、元のエラーを cause に持つ', async () => {
    const original = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    vi.spyOn(nodeFs.promises, 'access').mockRejectedValue(original);
    const target = path.join(tempDir, 'locked');

    const exit = await Effect.runPromiseExit(pathExistsAsync(target));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(PathExistenceCheckFailed);
        expect(failure.value.path).toBe(target);
        expect(failure.value.code).toBe('EACCES');
        expect(failure.value.cause).toBe(original);
      }
    }
  });

  it('code を持たないエラーも「存在しない」とはみなさない', async () => {
    vi.spyOn(nodeFs.promises, 'access').mockRejectedValue(new Error('boom'));

    const exit = await Effect.runPromiseExit(
      pathExistsAsync(path.join(tempDir, 'x')),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
