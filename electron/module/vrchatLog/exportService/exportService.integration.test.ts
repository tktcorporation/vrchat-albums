import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VRChatLogStoreFilePath } from '../model';
import { exportLogStore } from './exportService';

// logStorageManager をモック（logStoreディレクトリの場所をテスト用に差し替え）
vi.mock('../fileHandlers/logStorageManager', () => ({
  getLogStoreFilePathsInRange: vi.fn().mockResolvedValue([]),
}));

import { getLogStoreFilePathsInRange } from '../fileHandlers/logStorageManager';

const createMockFilePath = (
  filePath: string,
  yearMonth: string | null,
): VRChatLogStoreFilePath =>
  ({
    value: filePath,
    getYearMonth: () => yearMonth,
  }) as unknown as VRChatLogStoreFilePath;

describe('exportService integration', () => {
  let tempDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logstore-export-test-'));
    sourceDir = path.join(tempDir, 'source');
    await fs.mkdir(sourceDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // エラーは無視
    }
    vi.clearAllMocks();
  });

  it('logStoreファイルが実際にコピーされる', async () => {
    // ソースファイルを作成
    const monthDir = path.join(sourceDir, '2023-10');
    await fs.mkdir(monthDir, { recursive: true });
    const sourceFile = path.join(monthDir, 'logStore-2023-10.txt');
    const logContent = [
      '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
      '2023.10.08 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Test World',
      '2023.10.08 15:31:45 Log        -  [Behaviour] OnPlayerJoined TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
      '2023.10.08 15:32:45 Log        -  [Behaviour] OnPlayerLeft TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
    ].join('\n');
    await fs.writeFile(sourceFile, logContent, 'utf-8');

    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      createMockFilePath(sourceFile, '2023-10'),
    ]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      startDate: new Date('2023-10-01T00:00:00'),
      endDate: new Date('2023-10-31T23:59:59'),
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // 結果の検証
    expect(result.value.exportedFiles).toHaveLength(1);
    expect(result.value.totalLogLines).toBe(4);

    // ファイルが実際にコピーされたことを確認
    const exportedFilePath = result.value.exportedFiles[0];
    const fileExists = await fs
      .access(exportedFilePath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    // コピーされたファイルの内容が元と一致することを確認
    const copiedContent = await fs.readFile(exportedFilePath, 'utf-8');
    expect(copiedContent).toBe(logContent);

    // エクスポートフォルダの構造を確認
    expect(exportedFilePath).toMatch(
      /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
    );
    expect(exportedFilePath).toContain('2023-10');
    expect(exportedFilePath).toContain('logStore-2023-10.txt');
  });

  it('複数ファイルのコピーが正常に動作する', async () => {
    // 2つの月のソースファイルを作成
    const month09Dir = path.join(sourceDir, '2023-09');
    const month10Dir = path.join(sourceDir, '2023-10');
    await fs.mkdir(month09Dir, { recursive: true });
    await fs.mkdir(month10Dir, { recursive: true });

    const source09 = path.join(month09Dir, 'logStore-2023-09.txt');
    const source10 = path.join(month10Dir, 'logStore-2023-10.txt');

    await fs.writeFile(source09, 'line1\nline2\n', 'utf-8');
    await fs.writeFile(source10, 'line3\nline4\nline5\n', 'utf-8');

    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      createMockFilePath(source09, '2023-09'),
      createMockFilePath(source10, '2023-10'),
    ]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.exportedFiles).toHaveLength(2);
    expect(result.value.totalLogLines).toBe(5); // 2 + 3

    // 両方のファイルが存在することを確認
    for (const filePath of result.value.exportedFiles) {
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    }
  });

  it('ファイルが存在しない場合は空の結果を返す', async () => {
    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      startDate: new Date('2020-01-01T00:00:00'),
      endDate: new Date('2020-01-31T23:59:59'),
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.exportedFiles).toHaveLength(0);
    expect(result.value.totalLogLines).toBe(0);
  });
});
