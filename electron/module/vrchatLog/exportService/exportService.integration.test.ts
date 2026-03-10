import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ExportLogStoreOptions, exportLogStore } from './exportService';

// logStorageManagerをモック
vi.mock('../fileHandlers/logStorageManager', () => ({
  getLogStoreDir: vi.fn(),
  getLogStoreFilePathsInRange: vi.fn(),
}));

import {
  getLogStoreDir,
  getLogStoreFilePathsInRange,
} from '../fileHandlers/logStorageManager';

describe('exportService integration', () => {
  let tempLogStoreDir: string;
  let tempExportDir: string;

  beforeEach(async () => {
    // 一時logStoreディレクトリを作成
    tempLogStoreDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'logstore-test-'),
    );

    // 一時エクスポート先ディレクトリを作成
    tempExportDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'logstore-export-test-'),
    );

    // モックを設定
    vi.mocked(getLogStoreDir).mockReturnValue(tempLogStoreDir);
  });

  afterEach(async () => {
    vi.clearAllMocks();

    // 一時ディレクトリを削除
    try {
      await fs.rm(tempLogStoreDir, { recursive: true });
    } catch {
      // エラーは無視
    }
    try {
      await fs.rm(tempExportDir, { recursive: true });
    } catch {
      // エラーは無視
    }
  });

  it('logStoreからファイルコピーが正常に動作する', async () => {
    // テスト用のlogStoreファイルを作成
    const yearMonthDir = path.join(tempLogStoreDir, '2023-10');
    await fs.mkdir(yearMonthDir, { recursive: true });

    const testLogContent = [
      '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
      '2023.10.08 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Test World',
      '2023.10.08 15:31:45 Log        -  [Behaviour] OnPlayerJoined TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
      '2023.10.08 15:32:45 Log        -  [Behaviour] OnPlayerLeft TestPlayer',
    ].join('\n');

    const logStoreFilePath = path.join(yearMonthDir, 'logStore-2023-10.txt');
    await fs.writeFile(logStoreFilePath, testLogContent, 'utf-8');

    // モックの設定
    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      { value: logStoreFilePath } as ReturnType<
        typeof import('../fileHandlers/logStorageManager').getLogStoreFilePathsInRange
      > extends Promise<infer T>
        ? T extends (infer U)[]
          ? U
          : never
        : never,
    ]);

    // エクスポート実行
    const options: ExportLogStoreOptions = {
      startDate: new Date('2023-10-08T00:00:00'),
      endDate: new Date('2023-10-08T23:59:59'),
      outputBasePath: tempExportDir,
    };

    const exportResult = await exportLogStore(options);

    expect(exportResult.isOk()).toBe(true);
    if (!exportResult.isOk()) return;

    const result = exportResult.value;

    // 結果を検証
    expect(result.exportedFiles).toHaveLength(1);
    expect(result.totalLogLines).toBe(4);

    const exportedFilePath = result.exportedFiles[0];
    // 日時付きサブフォルダと月別サブフォルダが含まれることを確認
    expect(exportedFilePath).toMatch(
      /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
    );
    expect(exportedFilePath).toContain('2023-10');
    expect(exportedFilePath).toContain('logStore-2023-10.txt');

    // ファイルが実際に作成されていることを確認
    const fileExists = await fs
      .access(exportedFilePath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    // ファイル内容を確認
    const fileContent = await fs.readFile(exportedFilePath, 'utf-8');
    const lines = fileContent.split('\n');

    expect(lines[0]).toContain(
      '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_',
    );
    expect(lines[1]).toContain(
      '2023.10.08 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Test World',
    );
  });

  it('複数月のファイルをエクスポートできる', async () => {
    // 2つの月のディレクトリを作成
    const sep2023Dir = path.join(tempLogStoreDir, '2023-09');
    const oct2023Dir = path.join(tempLogStoreDir, '2023-10');
    await fs.mkdir(sep2023Dir, { recursive: true });
    await fs.mkdir(oct2023Dir, { recursive: true });

    // テスト用ログファイルを作成
    const sepLogPath = path.join(sep2023Dir, 'logStore-2023-09.txt');
    const octLogPath = path.join(oct2023Dir, 'logStore-2023-10.txt');

    await fs.writeFile(
      sepLogPath,
      '2023.09.30 23:30:00 Log        -  [Behaviour] Joining wrld_sep:12345\n2023.09.30 23:30:00 Log        -  [Behaviour] Joining or Creating Room: September World',
      'utf-8',
    );
    await fs.writeFile(
      octLogPath,
      '2023.10.01 01:00:00 Log        -  [Behaviour] Joining wrld_oct:54321\n2023.10.01 01:00:00 Log        -  [Behaviour] Joining or Creating Room: October World',
      'utf-8',
    );

    // モックの設定
    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      { value: sepLogPath },
      { value: octLogPath },
    ] as ReturnType<
      typeof import('../fileHandlers/logStorageManager').getLogStoreFilePathsInRange
    > extends Promise<infer T>
      ? T
      : never);

    const options: ExportLogStoreOptions = {
      startDate: new Date('2023-09-30T00:00:00'),
      endDate: new Date('2023-10-01T23:59:59'),
      outputBasePath: tempExportDir,
    };

    const exportResult = await exportLogStore(options);

    expect(exportResult.isOk()).toBe(true);
    if (!exportResult.isOk()) return;

    const result = exportResult.value;
    expect(result.exportedFiles).toHaveLength(2);
    expect(result.totalLogLines).toBe(4); // 2ファイル × 2行

    // 両方のファイルが含まれていることを確認
    expect(
      result.exportedFiles.some(
        (p: string) =>
          p.includes('2023-09') && p.includes('logStore-2023-09.txt'),
      ),
    ).toBe(true);
    expect(
      result.exportedFiles.some(
        (p: string) =>
          p.includes('2023-10') && p.includes('logStore-2023-10.txt'),
      ),
    ).toBe(true);
  });

  it('logStoreファイルが存在しない場合は空の結果を返す', async () => {
    // 空のlogStoreを返す
    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([]);

    const options: ExportLogStoreOptions = {
      startDate: new Date('2020-01-01T00:00:00'),
      endDate: new Date('2020-01-01T23:59:59'),
      outputBasePath: tempExportDir,
    };

    const exportResult = await exportLogStore(options);

    expect(exportResult.isOk()).toBe(true);
    if (!exportResult.isOk()) return;

    const result = exportResult.value;
    expect(result.exportedFiles).toHaveLength(0);
    expect(result.totalLogLines).toBe(0);
  });
});
