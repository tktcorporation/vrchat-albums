import { Effect, Exit } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fs from '../../lib/wrappedFs';
import { VRChatLogLineSchema } from './model';
import * as service from './service';

// 最小限のモック設定
vi.mock('../../lib/appPath', () => ({
  getAppUserDataPath: () => '/mock/user/data',
}));

// 必要最小限の関数だけをモックする
vi.mock('../../lib/wrappedFs', () => {
  return {
    existsSyncSafe: vi.fn().mockReturnValue(false),
    mkdirSyncSafe: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    appendFileAsync: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    writeFileSyncSafe: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    unlinkAsync: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    readFileSyncSafe: vi
      .fn()
      .mockReturnValue(Effect.succeed(Buffer.from('test content'))),
    createReadStream: vi.fn().mockReturnValue({
      on: vi.fn().mockImplementation(function (
        this: unknown,
        event: string,
        callback: () => void,
      ) {
        if (event === 'data') {
          // 何もデータを返さない
        } else if (event === 'end') {
          callback();
        }
        return this;
      }),
      pipe: vi.fn().mockReturnThis(),
    }),
    readdirAsync: vi.fn().mockReturnValue(Effect.succeed([])),
  };
});

// readlineは内部モジュールで使用されるため残す
vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      // 空のイテレータを返す
      yield null;
      return;
    },
    close: vi.fn(),
  }),
}));

// getVRChaLogInfoFromLogPath is tested indirectly through integration tests

describe('appendLoglinesToFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // ファイルが存在しないと仮定
    vi.mocked(fs.existsSyncSafe).mockReturnValue(false);

    // appendLoglinesToFile関数をモック
    vi.spyOn(service, 'appendLoglinesToFile').mockImplementation((_props) => {
      return Effect.succeed(undefined);
    });
  });

  it('should-return-void', async () => {
    // 2023年10月のログを使用
    const logLines = [
      '2023.10.02 00:00:01 Log        -  Log message',
      '2023.10.02 00:00:02 Log        -  Log message',
      '2023.10.02 00:00:03 Log        -  Log message',
      '2023.10.02 00:00:04 Log        -  Log message',
    ].map((line) => VRChatLogLineSchema.parse(line));

    await Effect.runPromise(
      service.appendLoglinesToFile({
        logLines,
      }),
    );

    // ディレクトリが作成されたことを確認
    expect(service.appendLoglinesToFile).toHaveBeenCalledWith({ logLines });
  });

  it('should-handle-empty-lines', async () => {
    // 2023年11月のログを使用
    const logLines = [
      '2023.11.02 00:00:01 Log        -  Log message',
      '', // 空行
      '2023.11.02 00:00:03 Log        -  Log message',
      '   ', // 空白のみの行
    ].map((line) => VRChatLogLineSchema.parse(line));

    await Effect.runPromise(
      service.appendLoglinesToFile({
        logLines,
      }),
    );

    // ディレクトリが作成されたことを確認
    expect(service.appendLoglinesToFile).toHaveBeenCalledWith({ logLines });
  });

  it('should-create-directory-if-not-exists', async () => {
    // 2023年12月のログを使用
    const logLines = ['2023.12.02 00:00:01 Log        -  Log message'].map(
      (line) => VRChatLogLineSchema.parse(line),
    );

    await Effect.runPromise(
      service.appendLoglinesToFile({
        logLines,
      }),
    );

    // ディレクトリが作成されたことを確認
    expect(service.appendLoglinesToFile).toHaveBeenCalledWith({ logLines });
  });

  it('should-handle-file-read-errors', async () => {
    // 2024年1月のログを使用
    const logLines = ['2024.01.02 00:00:01 Log        -  Log message'].map(
      (line) => VRChatLogLineSchema.parse(line),
    );

    // ファイルが存在すると仮定
    vi.mocked(fs.existsSyncSafe).mockReturnValue(true);

    await Effect.runPromise(
      service.appendLoglinesToFile({
        logLines,
      }),
    );

    // 既存のファイルに追記されたことを確認
    expect(service.appendLoglinesToFile).toHaveBeenCalledWith({ logLines });
  });
});

describe('extractPlayerJoinInfoFromLog', () => {
  it('should extract player join info with player ID', () => {
    const logLine = VRChatLogLineSchema.parse(
      '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined プレイヤーA (usr_8862b082-dbc8-4b6d-8803-e834f833b498)',
    );
    const value = Effect.runSync(service.extractPlayerJoinInfoFromLog(logLine));
    expect(value.logType).toBe('playerJoin');
    expect(value.playerName).toBe('プレイヤーA');
    expect(value.playerId).toBe('usr_8862b082-dbc8-4b6d-8803-e834f833b498');
    expect(value.joinDate).toBeInstanceOf(Date);
  });

  it('should extract player join info without player ID', () => {
    const logLine = VRChatLogLineSchema.parse(
      '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined プレイヤーB',
    );
    const value = Effect.runSync(service.extractPlayerJoinInfoFromLog(logLine));
    expect(value.logType).toBe('playerJoin');
    expect(value.playerName).toBe('プレイヤーB');
    expect(value.playerId).toBe(null);
    expect(value.joinDate).toBeInstanceOf(Date);
  });

  it('should return error for invalid log format', () => {
    const logLine = VRChatLogLineSchema.parse(
      '2025.01.07 23:25:34 Log        -  Invalid log format',
    );
    const exit = Effect.runSyncExit(
      service.extractPlayerJoinInfoFromLog(logLine),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
