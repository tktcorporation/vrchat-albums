import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VRChatLogStoreFilePath } from '../model';
import type { ExportManifest } from './exportService';
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

    // コピーされたファイルの内容が元と一致することを確認（バイト単位）
    const copiedContent = await fs.readFile(exportedFilePath, 'utf-8');
    expect(copiedContent).toBe(logContent);

    // ファイルサイズも一致
    const [srcStat, destStat] = await Promise.all([
      fs.stat(sourceFile),
      fs.stat(exportedFilePath),
    ]);
    expect(destStat.size).toBe(srcStat.size);

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
    expect(result.value.manifestPath).toBe('');
  });

  it('ラウンドトリップ: エクスポートしたファイルの内容がソースと完全一致する', async () => {
    const monthDir = path.join(sourceDir, '2023-10');
    await fs.mkdir(monthDir, { recursive: true });
    const sourceFile = path.join(monthDir, 'logStore-2023-10.txt');

    // 多様なログ行を含むコンテンツ
    const logContent = [
      '2023.10.01 00:00:01 Log        -  [Behaviour] Joining wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:11111',
      '2023.10.01 00:00:01 Log        -  [Behaviour] Joining or Creating Room: 日本語のワールド名',
      '2023.10.15 12:34:56 Log        -  [Behaviour] OnPlayerJoined テストプレイヤー (usr_11111111-2222-3333-4444-555555555555)',
      '2023.10.31 23:59:59 Log        -  [Behaviour] OnPlayerLeft AnotherPlayer (usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)',
    ].join('\n');
    await fs.writeFile(sourceFile, logContent, 'utf-8');

    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      createMockFilePath(sourceFile, '2023-10'),
    ]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // 内容の完全一致を検証
    const exportedContent = await fs.readFile(
      result.value.exportedFiles[0],
      'utf-8',
    );
    expect(exportedContent).toBe(logContent);

    // Bufferレベルでもバイト完全一致を確認
    const srcBuffer = await fs.readFile(sourceFile);
    const destBuffer = await fs.readFile(result.value.exportedFiles[0]);
    expect(destBuffer.equals(srcBuffer)).toBe(true);
  });

  it('splitファイル（タイムスタンプ付き）のエクスポートが正常に動作する', async () => {
    const monthDir = path.join(sourceDir, '2023-10');
    await fs.mkdir(monthDir, { recursive: true });

    const standardFile = path.join(monthDir, 'logStore-2023-10.txt');
    const splitFile = path.join(
      monthDir,
      'logStore-2023-10-20231015120000.txt',
    );

    const standardContent = 'standard-line1\nstandard-line2\n';
    const splitContent = 'split-line1\nsplit-line2\nsplit-line3\n';

    await fs.writeFile(standardFile, standardContent, 'utf-8');
    await fs.writeFile(splitFile, splitContent, 'utf-8');

    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      createMockFilePath(standardFile, '2023-10'),
      createMockFilePath(splitFile, '2023-10'),
    ]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.exportedFiles).toHaveLength(2);
    expect(result.value.totalLogLines).toBe(5); // 2 + 3

    // 両方のファイル内容が正しいことを検証
    const standardExported = result.value.exportedFiles.find((p) =>
      p.endsWith('logStore-2023-10.txt'),
    );
    const splitExported = result.value.exportedFiles.find((p) =>
      p.includes('logStore-2023-10-20231015120000.txt'),
    );

    expect(standardExported).toBeDefined();
    expect(splitExported).toBeDefined();

    const exportedStandardContent = await fs.readFile(
      standardExported as string,
      'utf-8',
    );
    const exportedSplitContent = await fs.readFile(
      splitExported as string,
      'utf-8',
    );

    expect(exportedStandardContent).toBe(standardContent);
    expect(exportedSplitContent).toBe(splitContent);
  });

  it('年跨ぎの複数月ファイルのエクスポートが正常に動作する', async () => {
    const month12Dir = path.join(sourceDir, '2023-12');
    const month01Dir = path.join(sourceDir, '2024-01');
    await fs.mkdir(month12Dir, { recursive: true });
    await fs.mkdir(month01Dir, { recursive: true });

    const source12 = path.join(month12Dir, 'logStore-2023-12.txt');
    const source01 = path.join(month01Dir, 'logStore-2024-01.txt');

    const content12 = '2023.12.31 23:59:00 Log        -  year-end-event\n';
    const content01 = '2024.01.01 00:00:01 Log        -  new-year-event\n';

    await fs.writeFile(source12, content12, 'utf-8');
    await fs.writeFile(source01, content01, 'utf-8');

    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      createMockFilePath(source12, '2023-12'),
      createMockFilePath(source01, '2024-01'),
    ]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.exportedFiles).toHaveLength(2);

    // 年別のディレクトリ構造を検証
    const exported12 = result.value.exportedFiles.find((p) =>
      p.includes('2023-12'),
    );
    const exported01 = result.value.exportedFiles.find((p) =>
      p.includes('2024-01'),
    );

    expect(exported12).toBeDefined();
    expect(exported01).toBeDefined();

    const exportedContent12 = await fs.readFile(exported12 as string, 'utf-8');
    const exportedContent01 = await fs.readFile(exported01 as string, 'utf-8');

    expect(exportedContent12).toBe(content12);
    expect(exportedContent01).toBe(content01);
  });

  it('エクスポート完了マニフェストが正しく書き出される', async () => {
    const monthDir = path.join(sourceDir, '2023-10');
    await fs.mkdir(monthDir, { recursive: true });
    const sourceFile = path.join(monthDir, 'logStore-2023-10.txt');
    const logContent = 'line1\nline2\nline3\n';
    await fs.writeFile(sourceFile, logContent, 'utf-8');

    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      createMockFilePath(sourceFile, '2023-10'),
    ]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // マニフェストファイルが存在することを確認
    expect(result.value.manifestPath).toBeTruthy();
    const manifestExists = await fs
      .access(result.value.manifestPath)
      .then(() => true)
      .catch(() => false);
    expect(manifestExists).toBe(true);

    // マニフェスト内容の検証
    const manifestContent = JSON.parse(
      await fs.readFile(result.value.manifestPath, 'utf-8'),
    ) as ExportManifest;

    expect(manifestContent.version).toBe(1);
    expect(manifestContent.status).toBe('completed');
    expect(manifestContent.totalLogLines).toBe(3);
    expect(manifestContent.files).toHaveLength(1);
    expect(manifestContent.exportDateTime).toBeDefined();

    // マニフェストの relativePath は常にPOSIX形式（/区切り）
    expect(manifestContent.files[0].relativePath).toBe(
      '2023-10/logStore-2023-10.txt',
    );

    // マニフェストのサイズが実際のファイルサイズと一致
    const exportedStat = await fs.stat(result.value.exportedFiles[0]);
    expect(manifestContent.files[0].sizeBytes).toBe(exportedStat.size);
  });

  it('マニフェストのrelativePathは常にPOSIX形式（/区切り）で保存される', async () => {
    const monthDir = path.join(sourceDir, '2023-10');
    await fs.mkdir(monthDir, { recursive: true });
    const sourceFile = path.join(monthDir, 'logStore-2023-10.txt');
    await fs.writeFile(sourceFile, 'line1\n', 'utf-8');

    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
      createMockFilePath(sourceFile, '2023-10'),
    ]);

    const outputDir = path.join(tempDir, 'output');
    const result = await exportLogStore({
      outputBasePath: outputDir,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // エクスポートされたファイルパスがOS固有の形式であることを確認
    const exportedFile = result.value.exportedFiles[0];
    expect(exportedFile).toBe(path.normalize(exportedFile));

    // マニフェストの relativePath はバックスラッシュを含まない（POSIX形式）
    const manifestContent = JSON.parse(
      await fs.readFile(result.value.manifestPath, 'utf-8'),
    ) as ExportManifest;
    const relPath = manifestContent.files[0].relativePath;
    expect(relPath).not.toContain('\\');
    expect(relPath).toBe('2023-10/logStore-2023-10.txt');
  });
});
