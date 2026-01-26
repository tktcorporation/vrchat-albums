/**
 * Sharp処理のメモリプロファイリングテスト
 *
 * このテストは初回起動時の大量写真処理におけるメモリ問題を検証します。
 * libvips（Sharp内部のCライブラリ）のネイティブメモリ使用量を含めて監視します。
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
import sharp from 'sharp';
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

interface MemoryReport {
  snapshots: MemorySnapshot[];
  peakRss: number;
  peakHeap: number;
  peakExternal: number;
  memoryGrowth: number;
}

// デバッグモードの判定
const isDebugMode = process.env.DEBUG_MEMORY === '1';

/**
 * メモリ使用量のスナップショットを取得
 */
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

/**
 * メモリレポートを生成
 */
const generateMemoryReport = (snapshots: MemorySnapshot[]): MemoryReport => {
  const peakRss = Math.max(...snapshots.map((s) => s.rssMB));
  const peakHeap = Math.max(...snapshots.map((s) => s.heapUsedMB));
  const peakExternal = Math.max(...snapshots.map((s) => s.externalMB));
  const memoryGrowth =
    snapshots.length > 1
      ? snapshots[snapshots.length - 1].rssMB - snapshots[0].rssMB
      : 0;

  return {
    snapshots,
    peakRss,
    peakHeap,
    peakExternal,
    memoryGrowth,
  };
};

/**
 * メモリレポートをコンソールに出力
 */
const printMemoryReport = (report: MemoryReport) => {
  console.log('\n=== Memory Profiling Report ===');
  console.log(`Peak RSS: ${report.peakRss.toFixed(2)} MB`);
  console.log(`Peak Heap: ${report.peakHeap.toFixed(2)} MB`);
  console.log(`Peak External: ${report.peakExternal.toFixed(2)} MB`);
  console.log(`Memory Growth: ${report.memoryGrowth.toFixed(2)} MB`);

  if (isDebugMode) {
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
  // VRChat写真サイズのダミー画像を生成
  const imageBuffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 100, b: 100 },
    },
  })
    .png()
    .toBuffer();

  await fs.writeFile(filePath, imageBuffer);
};

describe('Sharp メモリプロファイリング', () => {
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

  it('Sharp設定の現状を確認', () => {
    // 現在のSharp設定を出力
    console.log('\n=== Current Sharp Configuration ===');
    console.log(`Concurrency: ${sharp.concurrency()}`);
    console.log('Cache stats:', sharp.cache());
    console.log('SIMD enabled:', sharp.simd());
    console.log('Versions:', sharp.versions);
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
          const metadata = await sharp(photoPath).metadata();
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

    // 小規模バッチではメモリ増加が100MB未満であるべき
    expect(report.memoryGrowth).toBeLessThan(100);
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
          const metadata = await sharp(photoPath).metadata();
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

    // 中規模バッチではメモリ増加が200MB未満であるべき
    expect(report.memoryGrowth).toBeLessThan(200);
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
            const metadata = await sharp(photoPath).metadata();
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

    // 大規模バッチではメモリ増加が500MB未満であるべき（警告ライン）
    if (report.memoryGrowth > 500) {
      console.warn(
        `⚠️ WARNING: Memory growth exceeds 500MB (${report.memoryGrowth.toFixed(2)}MB)`,
      );
    }

    // Peak RSSが1GB未満であるべき
    expect(report.peakRss).toBeLessThan(1024);
  }, 60000);

  it('Sharp キャッシュ無効化時のメモリ使用量を比較', async () => {
    const photos = testPhotoPaths.slice(0, MEDIUM_BATCH_SIZE);

    // テスト1: キャッシュ有効（デフォルト）
    console.log('\n--- Test with cache ENABLED ---');
    if (global.gc) {
      global.gc();
    }

    const snapshotsWithCache: MemorySnapshot[] = [];
    snapshotsWithCache.push(takeMemorySnapshot('cache_enabled_before'));

    await Promise.all(
      photos.map(async (photoPath) => {
        return sharp(photoPath).metadata();
      }),
    );

    snapshotsWithCache.push(takeMemorySnapshot('cache_enabled_after'));

    const reportWithCache = generateMemoryReport(snapshotsWithCache);
    console.log(
      `Memory growth with cache: ${reportWithCache.memoryGrowth.toFixed(2)}MB`,
    );

    // テスト2: キャッシュ無効化
    console.log('\n--- Test with cache DISABLED ---');
    sharp.cache(false);

    if (global.gc) {
      global.gc();
    }

    const snapshotsNoCache: MemorySnapshot[] = [];
    snapshotsNoCache.push(takeMemorySnapshot('cache_disabled_before'));

    await Promise.all(
      photos.map(async (photoPath) => {
        return sharp(photoPath).metadata();
      }),
    );

    snapshotsNoCache.push(takeMemorySnapshot('cache_disabled_after'));

    const reportNoCache = generateMemoryReport(snapshotsNoCache);
    console.log(
      `Memory growth without cache: ${reportNoCache.memoryGrowth.toFixed(2)}MB`,
    );

    // キャッシュを元に戻す
    sharp.cache({ memory: 50, files: 20, items: 200 });

    // 比較結果を出力
    console.log('\n=== Cache Comparison ===');
    console.log(
      `With cache: ${reportWithCache.memoryGrowth.toFixed(2)}MB growth`,
    );
    console.log(
      `Without cache: ${reportNoCache.memoryGrowth.toFixed(2)}MB growth`,
    );
    console.log(
      `Difference: ${(reportWithCache.memoryGrowth - reportNoCache.memoryGrowth).toFixed(2)}MB`,
    );
  });

  it('並列数の変更によるメモリ使用量の変化を計測', async () => {
    const photos = testPhotoPaths.slice(0, MEDIUM_BATCH_SIZE);
    const parallelLimits = [2, 5, 10, 20];

    console.log('\n=== Concurrency Impact Test ===');

    for (const limit of parallelLimits) {
      if (global.gc) {
        global.gc();
      }

      const snapshots: MemorySnapshot[] = [];
      snapshots.push(takeMemorySnapshot(`parallel_${limit}_before`));

      for (let i = 0; i < photos.length; i += limit) {
        const batch = photos.slice(i, i + limit);

        await Promise.all(
          batch.map(async (photoPath) => {
            return sharp(photoPath).metadata();
          }),
        );
      }

      snapshots.push(takeMemorySnapshot(`parallel_${limit}_after`));

      const report = generateMemoryReport(snapshots);
      console.log(
        `PARALLEL_LIMIT=${limit}: Peak RSS=${report.peakRss.toFixed(2)}MB, ` +
          `Growth=${report.memoryGrowth.toFixed(2)}MB`,
      );
    }
  });

  it('libvips concurrency設定の影響を計測', async () => {
    const photos = testPhotoPaths.slice(0, MEDIUM_BATCH_SIZE);
    const concurrencySettings = [1, 2, 4, 0]; // 0 = CPUコア数

    console.log('\n=== libvips Concurrency Impact Test ===');
    console.log(`CPU cores: ${os.cpus().length}`);

    for (const setting of concurrencySettings) {
      sharp.concurrency(setting);
      const actualConcurrency = sharp.concurrency();

      if (global.gc) {
        global.gc();
      }

      const snapshots: MemorySnapshot[] = [];
      snapshots.push(takeMemorySnapshot(`concurrency_${setting}_before`));

      await Promise.all(
        photos.map(async (photoPath) => {
          return sharp(photoPath).metadata();
        }),
      );

      snapshots.push(takeMemorySnapshot(`concurrency_${setting}_after`));

      const report = generateMemoryReport(snapshots);
      console.log(
        `sharp.concurrency(${setting}) [actual: ${actualConcurrency}]: ` +
          `Peak RSS=${report.peakRss.toFixed(2)}MB, ` +
          `Growth=${report.memoryGrowth.toFixed(2)}MB`,
      );
    }

    // デフォルトに戻す
    sharp.concurrency(0);
  });
});
