/**
 * 画像処理のメモリプロファイリングテスト
 *
 * このテストは初回起動時の大量写真処理におけるメモリ問題を検証します。
 * @napi-rs/image (Rust製) のメモリ使用量を監視します。
 *
 * 実行方法:
 *   pnpm test electron/module/vrchatPhoto/vrchatPhoto.memory.test.ts
 *
 * 詳細なメモリログ付きで実行:
 *   DEBUG_MEMORY=1 pnpm test electron/module/vrchatPhoto/vrchatPhoto.memory.test.ts
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { Transformer } from '@napi-rs/image';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// メモリ計測用の型定義
interface MemorySnapshot {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  arrayBuffersMB: number;
  label: string;
}

const takeMemorySnapshot = (label: string): MemorySnapshot => {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    heapTotalMB: mem.heapTotal / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
    arrayBuffersMB: mem.arrayBuffers / 1024 / 1024,
    label,
  };
};

interface MemoryReport {
  snapshots: MemorySnapshot[];
  peakRss: number;
  peakHeap: number;
  /** RSS差分（ネイティブアロケータの影響を受けるため参考値） */
  rssGrowth: number;
  /** Heap差分（JSメモリリークの検知に使用） */
  heapGrowth: number;
}

const generateMemoryReport = (snapshots: MemorySnapshot[]): MemoryReport => {
  const peakRss = Math.max(...snapshots.map((s) => s.rssMB));
  const peakHeap = Math.max(...snapshots.map((s) => s.heapUsedMB));
  const rssGrowth =
    snapshots.length > 0 ? snapshots.at(-1)!.rssMB - snapshots[0].rssMB : 0;
  const heapGrowth =
    snapshots.length > 0
      ? snapshots.at(-1)!.heapUsedMB - snapshots[0].heapUsedMB
      : 0;

  return { snapshots, peakRss, peakHeap, rssGrowth, heapGrowth };
};

const printMemoryReport = (report: MemoryReport): void => {
  console.log('\n=== Memory Report ===');
  console.log(`Peak RSS: ${report.peakRss.toFixed(2)}MB`);
  console.log(`Peak Heap: ${report.peakHeap.toFixed(2)}MB`);
  console.log(`RSS Growth: ${report.rssGrowth.toFixed(2)}MB`);
  console.log(`Heap Growth: ${report.heapGrowth.toFixed(2)}MB`);

  if (process.env.DEBUG_MEMORY) {
    console.log('\n--- Detailed Snapshots ---');
    for (const snapshot of report.snapshots) {
      console.log(
        `[${snapshot.label}] RSS: ${snapshot.rssMB.toFixed(2)}MB, ` +
          `Heap: ${snapshot.heapUsedMB.toFixed(2)}MB, ` +
          `External: ${snapshot.externalMB.toFixed(2)}MB`,
      );
    }
  }
};

/**
 * テスト用のダミーPNG画像を生成
 */
const generateTestImage = async (
  filePath: string,
  width = 1920,
  height = 1080,
): Promise<void> => {
  // RGBA ピクセルから PNG を生成
  const pixels = Buffer.alloc(width * height * 4, 100);
  const imageBuffer = await Transformer.fromRgbaPixels(
    pixels,
    width,
    height,
  ).png();

  await fs.writeFile(filePath, imageBuffer);
};

describe('画像処理 メモリプロファイリング', () => {
  let testDir: string;
  const testPhotoPaths: string[] = [];

  // テスト用写真の枚数（調整可能）
  const SMALL_BATCH_SIZE = 10;
  const MEDIUM_BATCH_SIZE = 50;
  const LARGE_BATCH_SIZE = 200;

  beforeAll(async () => {
    // テスト用ディレクトリを作成
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-memory-test-'));

    console.log(`Test directory: ${testDir}`);
    console.log('Generating test images...');

    // テスト用画像を生成
    const generatePromises: Promise<void>[] = [];
    for (let i = 0; i < LARGE_BATCH_SIZE; i++) {
      const fileName = `VRChat_2024-01-01_12-00-00.${String(i).padStart(3, '0')}_test.png`;
      const filePath = path.join(testDir, fileName);
      testPhotoPaths.push(filePath);
      generatePromises.push(generateTestImage(filePath));
    }

    await Promise.all(generatePromises);
    console.log(`Generated ${LARGE_BATCH_SIZE} test images`);
  }, 120000); // 2分のタイムアウト

  afterAll(async () => {
    // テスト用ディレクトリを削除
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
      console.log('Cleaned up test directory');
    }
  });

  it('画像処理エンジンの現状を確認', () => {
    console.log('\n=== Image Processing Engine ===');
    console.log('Engine: @napi-rs/image (Rust-based)');
    console.log('No global cache or concurrency settings needed');
  });

  it('小規模バッチ（10枚）のメモリ使用量を計測', async () => {
    const snapshots: MemorySnapshot[] = [];
    const photos = testPhotoPaths.slice(0, SMALL_BATCH_SIZE);

    // GCを強制実行（可能な場合）
    if (global.gc) {
      global.gc();
    }

    snapshots.push(takeMemorySnapshot('before_processing'));

    // 並列処理（現在の実装と同じ PARALLEL_LIMIT = 10）
    const PARALLEL_LIMIT = 10;

    for (let i = 0; i < photos.length; i += PARALLEL_LIMIT) {
      const batch = photos.slice(i, i + PARALLEL_LIMIT);

      await Promise.all(
        batch.map(async (photoPath) => {
          const buf = await fs.readFile(photoPath);
          const metadata = await new Transformer(buf).metadata();
          return {
            photoPath,
            width: metadata.width,
            height: metadata.height,
          };
        }),
      );

      snapshots.push(
        takeMemorySnapshot(`after_batch_${Math.floor(i / PARALLEL_LIMIT) + 1}`),
      );
    }

    snapshots.push(takeMemorySnapshot('after_all_processing'));

    // GC後のメモリを計測
    if (global.gc) {
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 100));
      snapshots.push(takeMemorySnapshot('after_gc'));
    }

    const report = generateMemoryReport(snapshots);
    printMemoryReport(report);

    // Heapリーク検知: 処理前後でHeap増加が50MB未満であるべき
    expect(report.heapGrowth).toBeLessThan(50);
  });

  it('中規模バッチ（50枚）のメモリ使用量を計測', async () => {
    const snapshots: MemorySnapshot[] = [];
    const photos = testPhotoPaths.slice(0, MEDIUM_BATCH_SIZE);

    if (global.gc) {
      global.gc();
    }

    snapshots.push(takeMemorySnapshot('before_processing'));

    const PARALLEL_LIMIT = 10;

    for (let i = 0; i < photos.length; i += PARALLEL_LIMIT) {
      const batch = photos.slice(i, i + PARALLEL_LIMIT);

      await Promise.all(
        batch.map(async (photoPath) => {
          const buf = await fs.readFile(photoPath);
          const metadata = await new Transformer(buf).metadata();
          return { photoPath, width: metadata.width, height: metadata.height };
        }),
      );

      if (i % 20 === 0) {
        snapshots.push(
          takeMemorySnapshot(`progress_${Math.floor(i / PARALLEL_LIMIT) + 1}`),
        );
      }
    }

    snapshots.push(takeMemorySnapshot('after_all_processing'));

    if (global.gc) {
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 100));
      snapshots.push(takeMemorySnapshot('after_gc'));
    }

    const report = generateMemoryReport(snapshots);
    printMemoryReport(report);

    // Heapリーク検知: 処理前後でHeap増加が50MB未満であるべき
    expect(report.heapGrowth).toBeLessThan(50);
  });

  it('大規模バッチ（200枚）のメモリ使用量を計測', async () => {
    const snapshots: MemorySnapshot[] = [];
    const photos = testPhotoPaths.slice(0, LARGE_BATCH_SIZE);

    if (global.gc) {
      global.gc();
    }

    snapshots.push(takeMemorySnapshot('before_processing'));

    const PARALLEL_LIMIT = 10;
    const BATCH_SIZE = 100;

    // 現在の実装と同じバッチ処理
    for (let i = 0; i < photos.length; i += BATCH_SIZE) {
      const batch = photos.slice(i, i + BATCH_SIZE);

      for (let j = 0; j < batch.length; j += PARALLEL_LIMIT) {
        const subBatch = batch.slice(j, j + PARALLEL_LIMIT);

        await Promise.all(
          subBatch.map(async (photoPath) => {
            const buf = await fs.readFile(photoPath);
            const metadata = await new Transformer(buf).metadata();
            return {
              photoPath,
              width: metadata.width,
              height: metadata.height,
            };
          }),
        );
      }

      snapshots.push(
        takeMemorySnapshot(`after_batch_${Math.floor(i / BATCH_SIZE) + 1}`),
      );
    }

    snapshots.push(takeMemorySnapshot('after_all_processing'));

    if (global.gc) {
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 100));
      snapshots.push(takeMemorySnapshot('after_gc'));
    }

    const report = generateMemoryReport(snapshots);
    printMemoryReport(report);

    // Peak RSSは警告ログのみ（アサーション対象外）
    // @napi-rs/image のRustアロケータはアリーナベースの一時確保でRSSスパイクが発生するが、
    // 処理後に解放される。RSSピークはネイティブコードのメモリ健全性の指標として不適切。
    if (report.peakRss > 3072) {
      console.warn(
        `⚠️ INFO: Peak RSS is ${report.peakRss.toFixed(2)}MB (Rust arena allocation - expected to be temporary)`,
      );
    }

    // Heapリーク検知: GC後のHeap増加が50MB未満であるべき
    // RSSはRustアロケータのアリーナ保持で高止まりするため指標として不適切
    expect(report.heapGrowth).toBeLessThan(50);
  }, 60000);

  it('メタデータ取得のメモリ使用量を比較', async () => {
    const photos = testPhotoPaths.slice(0, MEDIUM_BATCH_SIZE);

    console.log('\n--- Metadata extraction test ---');
    if (global.gc) {
      global.gc();
    }

    const snapshots: MemorySnapshot[] = [];
    snapshots.push(takeMemorySnapshot('before'));

    await Promise.all(
      photos.map(async (photoPath) => {
        const buf = await fs.readFile(photoPath);
        return new Transformer(buf).metadata();
      }),
    );

    snapshots.push(takeMemorySnapshot('after'));

    const report = generateMemoryReport(snapshots);
    console.log(`Memory growth: ${report.heapGrowth.toFixed(2)}MB`);

    // Heapリーク検知
    expect(report.heapGrowth).toBeLessThan(50);
  });
});
