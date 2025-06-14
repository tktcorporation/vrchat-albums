import * as nodeFs from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline';
import neverthrow from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from '../../../lib/wrappedFs';
import { appendLoglinesToFile } from './fileHandlers/logStorageManager';
import { VRChatLogLineSchema, VRChatLogStoreFilePathSchema } from './model';

// モック設定
vi.mock('../../../lib/wrappedApp', () => ({
  getAppUserDataPath: () => '/mock/user/data',
}));

// 実際の関数をモックする
vi.mock('../../../lib/wrappedFs', () => {
  return {
    existsSyncSafe: vi.fn().mockReturnValue(false),
    mkdirSyncSafe: vi.fn().mockResolvedValue(neverthrow.ok(undefined)),
    appendFileAsync: vi.fn().mockResolvedValue(neverthrow.ok(undefined)),
    writeFileSyncSafe: vi.fn().mockResolvedValue(neverthrow.ok(undefined)),
    unlinkAsync: vi.fn().mockResolvedValue(neverthrow.ok(undefined)),
    readFileSyncSafe: vi
      .fn()
      .mockReturnValue(neverthrow.ok(Buffer.from('test content'))),
    createReadStream: vi.fn().mockReturnValue({
      on: vi.fn().mockImplementation(function (event, callback) {
        if (event === 'data') {
          // 何もデータを返さない
        } else if (event === 'end') {
          callback();
        }
        return this;
      }),
      pipe: vi.fn().mockReturnThis(),
    }),
    readdirAsync: vi.fn().mockResolvedValue(neverthrow.ok([])),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    statSync: vi.fn().mockReturnValue({ size: 100 }), // 小さいサイズを返す
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readdir: vi
      .fn()
      .mockImplementation((_path, callback) => callback(null, [])),
  };
});

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

describe('appendLoglinesToFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // ファイルが存在しないと仮定
    vi.mocked(fs.existsSyncSafe).mockReturnValue(false);
    vi.mocked(fs.readFileSyncSafe).mockReturnValue(
      neverthrow.ok(Buffer.from('')),
    );
  });

  it('ログが空の場合は何もしない', async () => {
    const result = await appendLoglinesToFile({
      logLines: [],
    });

    expect(result.isOk()).toBe(true);
    expect(fs.existsSyncSafe).not.toHaveBeenCalled();
    expect(fs.appendFileAsync).not.toHaveBeenCalled();
  });

  it('新しいファイルにログを書き込む', async () => {
    const logLines = [
      VRChatLogLineSchema.parse('2024.01.15 12:00:00 Log entry 1'),
    ];

    const result = await appendLoglinesToFile({
      logLines,
    });

    expect(result.isOk()).toBe(true);
    expect(fs.writeFileSyncSafe).toHaveBeenCalledWith(
      expect.stringContaining('logStore-2024-01.txt'),
      '2024.01.15 12:00:00 Log entry 1\n',
    );
  });

  it('既存ファイルにログを追記する', async () => {
    // ファイルが存在すると仮定
    vi.mocked(fs.existsSyncSafe).mockReturnValue(true);
    vi.mocked(fs.readFileSyncSafe).mockReturnValue(
      neverthrow.ok(Buffer.from('2024.01.14 11:00:00 Existing log\n')),
    );

    const logLines = [
      VRChatLogLineSchema.parse('2024.01.15 12:00:00 New log entry'),
    ];

    const result = await appendLoglinesToFile({
      logLines,
    });

    expect(result.isOk()).toBe(true);
    expect(fs.appendFileAsync).toHaveBeenCalledWith(
      expect.stringContaining('logStore-2024-01.txt'),
      '2024.01.15 12:00:00 New log entry\n',
    );
  });

  it('重複ログは追記されない', async () => {
    // ファイルが存在すると仮定
    vi.mocked(fs.existsSyncSafe).mockReturnValue(true);
    vi.mocked(fs.readFileSyncSafe).mockReturnValue(
      neverthrow.ok(Buffer.from('2024.01.15 12:00:00 Existing log\n')),
    );

    const logLines = [
      VRChatLogLineSchema.parse('2024.01.15 12:00:00 Existing log'),
    ];

    const result = await appendLoglinesToFile({
      logLines,
    });

    expect(result.isOk()).toBe(true);
    expect(fs.appendFileAsync).not.toHaveBeenCalled();
  });

  it('既存ファイルが上書きされない（追記のみ）', async () => {
    // ファイルが存在すると仮定
    vi.mocked(fs.existsSyncSafe).mockReturnValue(true);
    vi.mocked(fs.readFileSyncSafe).mockReturnValue(
      neverthrow.ok(
        Buffer.from(
          '2024.01.14 11:00:00 Existing log 1\n2024.01.14 12:00:00 Existing log 2\n',
        ),
      ),
    );

    const logLines = [
      VRChatLogLineSchema.parse('2024.01.15 12:00:00 New log entry'),
    ];

    const result = await appendLoglinesToFile({
      logLines,
    });

    expect(result.isOk()).toBe(true);

    // writeFileSyncSafeが呼ばれていないことを確認（上書きしていない）
    expect(fs.writeFileSyncSafe).not.toHaveBeenCalled();

    // appendFileAsyncが呼ばれていることを確認（追記している）
    expect(fs.appendFileAsync).toHaveBeenCalledWith(
      expect.stringContaining('logStore-2024-01.txt'),
      '2024.01.15 12:00:00 New log entry\n',
    );
  });

  it('混在パターン：既存ログ保持＋新規ログ追記＋重複ログ除外', async () => {
    // 複数の既存ログがあるファイル
    vi.mocked(fs.existsSyncSafe).mockReturnValue(true);
    vi.mocked(fs.readFileSyncSafe).mockReturnValue(
      neverthrow.ok(
        Buffer.from(
          '2024.01.14 11:00:00 Existing log 1\n2024.01.14 12:00:00 Existing log 2\n',
        ),
      ),
    );

    const logLines = [
      VRChatLogLineSchema.parse('2024.01.14 12:00:00 Existing log 2'), // 重複
      VRChatLogLineSchema.parse('2024.01.15 12:00:00 New log entry 1'), // 新規
      VRChatLogLineSchema.parse('2024.01.15 13:00:00 New log entry 2'), // 新規
    ];

    const result = await appendLoglinesToFile({
      logLines,
    });

    expect(result.isOk()).toBe(true);

    // 上書きされていない
    expect(fs.writeFileSyncSafe).not.toHaveBeenCalled();

    // 新規ログのみが追記されている（重複は除外）
    expect(fs.appendFileAsync).toHaveBeenCalledWith(
      expect.stringContaining('logStore-2024-01.txt'),
      '2024.01.15 12:00:00 New log entry 1\n2024.01.15 13:00:00 New log entry 2\n',
    );
  });
});
