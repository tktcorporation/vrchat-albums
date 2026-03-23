import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppUserDataPath } from '../../lib/wrappedApp';
import { VRChatLogLineSchema } from './model';
import { appendLoglinesToFile, getLogStoreFilePathsInRange } from './service';

// getAppUserDataPathのモックのみ設定する
vi.mock('../../lib/wrappedApp', () => ({
  getAppUserDataPath: vi.fn(),
}));

/**
 * 実際のファイルシステムを使用した統合テスト
 * このテストでは実際にファイルを作成して読み取ります
 */
describe('タイムスタンプ付きログファイルの実際のファイルシステムを使った統合テスト', () => {
  // テスト用の一時ディレクトリパス
  const testDir = path.join(process.cwd(), 'test-temp');
  const logStoreDir = path.join(testDir, 'logStore');
  const testYearMonth = '2024-05';
  const testMonthDir = path.join(logStoreDir, testYearMonth);

  // テスト前の準備
  beforeEach(() => {
    // モックを設定
    vi.mocked(getAppUserDataPath).mockReturnValue(testDir);

    // テスト用の一時ディレクトリを作成
    if (!nodeFs.existsSync(testDir)) {
      nodeFs.mkdirSync(testDir, { recursive: true });
    }
    if (!nodeFs.existsSync(logStoreDir)) {
      nodeFs.mkdirSync(logStoreDir, { recursive: true });
    }
    if (!nodeFs.existsSync(testMonthDir)) {
      nodeFs.mkdirSync(testMonthDir, { recursive: true });
    }
  });

  // テスト後のクリーンアップ
  afterEach(() => {
    // 作成したファイルやディレクトリを削除
    if (nodeFs.existsSync(testDir)) {
      // ディレクトリ内のファイルを先に削除
      const deleteFilesRecursively = (dirPath: string) => {
        if (nodeFs.existsSync(dirPath)) {
          for (const file of nodeFs.readdirSync(dirPath)) {
            const curPath = path.join(dirPath, file);
            if (nodeFs.lstatSync(curPath).isDirectory()) {
              // 再帰的に削除
              deleteFilesRecursively(curPath);
            } else {
              // ファイルを削除
              nodeFs.unlinkSync(curPath);
            }
          }

          // 空になったディレクトリを削除
          nodeFs.rmdirSync(dirPath);
        }
      };

      deleteFilesRecursively(testDir);
    }

    // 実行時刻を元に戻す
    vi.useRealTimers();
  });

  it('タイムスタンプ付きログファイルを作成し、実際に検索できること', async () => {
    // 実際の日付を固定
    const mockDate = new Date('2024-05-15T15:45:30');
    vi.setSystemTime(mockDate);

    try {
      // テスト用のログデータ
      const logLines = [
        VRChatLogLineSchema.parse('2024.05.15 12:00:00 Log entry 1'),
        VRChatLogLineSchema.parse('2024.05.15 15:30:00 Log entry 2'),
      ];

      // 最初に通常のログファイルを作成
      const standardLogPath = path.join(
        testMonthDir,
        `logStore-${testYearMonth}.txt`,
      );

      // 10MBより大きなファイルを作成する
      const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
      nodeFs.writeFileSync(standardLogPath, largeContent);

      // ファイルサイズを確認
      const stats = nodeFs.statSync(standardLogPath);
      console.log(`Test file size: ${stats.size} bytes`);
      expect(stats.size).toBeGreaterThan(10 * 1024 * 1024); // 10MB以上であることを確認

      // appendLoglinesToFileを実行（実際にファイルが作成される）
      await Effect.runPromise(
        appendLoglinesToFile({
          logLines,
        }),
      );

      // タイムスタンプ付きファイルが作成されていることを確認
      const expectedTimestampedFileName = `logStore-${testYearMonth}-20240515154530.txt`;
      const timestampedFilePath = path.join(
        testMonthDir,
        expectedTimestampedFileName,
      );
      expect(nodeFs.existsSync(timestampedFilePath)).toBe(true);

      // ファイルの内容を確認
      const fileContent = nodeFs.readFileSync(timestampedFilePath, 'utf8');
      expect(fileContent).toContain('2024.05.15 12:00:00 Log entry 1');
      expect(fileContent).toContain('2024.05.15 15:30:00 Log entry 2');

      // getLogStoreFilePathsInRangeを使用して日付範囲内のファイルを検索
      const startDate = new Date('2024-05-01');
      const endDate = new Date('2024-05-31');

      const logPaths = await getLogStoreFilePathsInRange(startDate, endDate);

      // ログファイルの詳細を出力
      console.log(`Found ${logPaths.length} log files:`);
      for (const p of logPaths) {
        console.log(`- ${p.value}`);
      }

      // 予想を修正：レガシーファイルが含まれる場合があるので、2つ以上のファイルが見つかるはず
      expect(logPaths.length).toBeGreaterThanOrEqual(2);

      // 標準形式のファイルとタイムスタンプ付きファイルの両方が含まれているか確認
      const standardPathFound = logPaths.some(
        (p) => p.value === standardLogPath,
      );
      const timestampedPathFound = logPaths.some(
        (p) => p.value === timestampedFilePath,
      );

      expect(standardPathFound).toBe(true);
      expect(timestampedPathFound).toBe(true);

      // VRChatLogStoreFilePathクラスのメソッドをテスト
      const timestampedPath = logPaths.find(
        (p) => p.value === timestampedFilePath,
      );

      expect(timestampedPath).toBeDefined();
      if (timestampedPath) {
        // 年月の取得
        expect(timestampedPath.getYearMonth()).toBe(testYearMonth);

        // タイムスタンプ付きかどうかの判定
        expect(timestampedPath.hasTimestamp()).toBe(true);

        // タイムスタンプの取得
        const timestamp = timestampedPath.getTimestamp();
        expect(timestamp).toBeInstanceOf(Date);
        expect(timestamp?.getFullYear()).toBe(2024);
        expect(timestamp?.getMonth()).toBe(4); // 0-indexed
        expect(timestamp?.getDate()).toBe(15);
        expect(timestamp?.getHours()).toBe(15);
        expect(timestamp?.getMinutes()).toBe(45);
        expect(timestamp?.getSeconds()).toBe(30);
      }

      // 通常のパスについても検証
      const standardPath = logPaths.find((p) => p.value === standardLogPath);

      expect(standardPath).toBeDefined();
      if (standardPath) {
        expect(standardPath.getYearMonth()).toBe(testYearMonth);
        expect(standardPath.hasTimestamp()).toBe(false);
        expect(standardPath.getTimestamp()).toBeNull();
      }
    } finally {
      // クリーンアップはafterEachで行われます
    }
  });
});
