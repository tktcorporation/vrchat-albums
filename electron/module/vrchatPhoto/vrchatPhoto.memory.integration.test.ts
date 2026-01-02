/**
 * 写真インデックス作成のメモリプロファイリング統合テスト
 *
 * 実際の createVRChatPhotoPathIndex 関数を使用して、
 * 初回起動時の大量写真処理におけるメモリ使用状況をテストします。
 *
 * 実行方法:
 *   yarn test electron/module/vrchatPhoto/vrchatPhoto.memory.integration.test.ts
 *
 * 大量写真でテスト（時間がかかります）:
 *   PHOTO_COUNT=1000 yarn test electron/module/vrchatPhoto/vrchatPhoto.memory.integration.test.ts
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as client from '../../lib/sequelize';
import {
  type getSettingStore,
  initSettingStoreForTest,
  type PhotoFolderScanStates,
} from '../settingStore';

// メモリ計測用の型定義
interface MemorySnapshot {
  timestamp: number;
  heapUsedMB: number;
  rssMB: number;
  externalMB: number;
  label: string;
}

interface MemoryReport {
  snapshots: MemorySnapshot[];
  peakRss: number;
  peakHeap: number;
  memoryGrowth: number;
}

// テスト写真の枚数（環境変数で上書き可能）
const PHOTO_COUNT = Number.parseInt(process.env.PHOTO_COUNT || '500', 10);

// 4K解像度（実際のVRChat写真に近い）
const PHOTO_WIDTH = 3840;
const PHOTO_HEIGHT = 2160;

/**
 * メモリ使用量のスナップショットを取得
 */
const takeMemorySnapshot = (label: string): MemorySnapshot => {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    label,
  };
};

/**
 * メモリレポートを生成
 */
const generateMemoryReport = (snapshots: MemorySnapshot[]): MemoryReport => {
  const peakRss = Math.max(...snapshots.map((s) => s.rssMB));
  const peakHeap = Math.max(...snapshots.map((s) => s.heapUsedMB));
  const memoryGrowth =
    snapshots.length > 1
      ? snapshots[snapshots.length - 1].rssMB - snapshots[0].rssMB
      : 0;

  return { snapshots, peakRss, peakHeap, memoryGrowth };
};

/**
 * テスト用のダミーPNG画像を生成
 */
const generateTestImage = async (
  filePath: string,
  width: number,
  height: number,
): Promise<void> => {
  const imageBuffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: {
        r: Math.floor(Math.random() * 255),
        g: Math.floor(Math.random() * 255),
        b: Math.floor(Math.random() * 255),
      },
    },
  })
    .png({ compressionLevel: 1 }) // 高速化のため圧縮レベルを下げる
    .toBuffer();

  await fs.writeFile(filePath, imageBuffer);
};

describe('写真インデックス作成のメモリプロファイリング', () => {
  let testDir: string;
  let testPhotosDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let photoFolderScanStates: PhotoFolderScanStates = {};

  beforeAll(async () => {
    // テスト用ディレクトリを作成
    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'vrchat-photo-memory-test-'),
    );
    testPhotosDir = path.join(testDir, 'VRChat');
    await fs.mkdir(testPhotosDir, { recursive: true });

    // SettingStoreのモックを作成
    const mockSettingStore = {
      getVRChatPhotoDir: () => testPhotosDir,
      setVRChatPhotoDir: (_dir: string) => {},
      getVRChatPhotoExtraDirList: () => [],
      setVRChatPhotoExtraDirList: (_dirs: string[]) => {},
      getPhotoFolderScanStates: () => photoFolderScanStates,
      setPhotoFolderScanStates: (states: PhotoFolderScanStates) => {
        photoFolderScanStates = states;
      },
      clearPhotoFolderScanStates: () => {
        photoFolderScanStates = {};
      },
    } as unknown as ReturnType<typeof getSettingStore>;

    initSettingStoreForTest(mockSettingStore);

    // DBを初期化
    client.__initTestRDBClient();

    console.log(`\n=== Test Configuration ===`);
    console.log(`Test directory: ${testDir}`);
    console.log(`Photo count: ${PHOTO_COUNT}`);
    console.log(`Photo size: ${PHOTO_WIDTH}x${PHOTO_HEIGHT}`);
    console.log(`Sharp concurrency: ${sharp.concurrency()}`);
    console.log(`Sharp cache:`, sharp.cache());

    // 環境変数をバックアップ
    originalEnv = { ...process.env };

    console.log('\nGenerating test images...');
    const startTime = Date.now();

    // 日付形式でファイル名を生成
    const baseDate = new Date('2024-01-01T12:00:00.000');

    // 並列でテスト画像を生成（生成時間を短縮）
    const GENERATE_BATCH_SIZE = 50;
    for (let i = 0; i < PHOTO_COUNT; i += GENERATE_BATCH_SIZE) {
      const batch = [];
      for (let j = i; j < Math.min(i + GENERATE_BATCH_SIZE, PHOTO_COUNT); j++) {
        const date = new Date(baseDate.getTime() + j * 1000);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}.${String(j % 1000).padStart(3, '0')}`;
        const fileName = `VRChat_${dateStr}_test.png`;
        const filePath = path.join(testPhotosDir, fileName);
        batch.push(generateTestImage(filePath, PHOTO_WIDTH, PHOTO_HEIGHT));
      }
      await Promise.all(batch);

      if (
        (i + GENERATE_BATCH_SIZE) % 100 === 0 ||
        i + GENERATE_BATCH_SIZE >= PHOTO_COUNT
      ) {
        console.log(
          `Generated ${Math.min(i + GENERATE_BATCH_SIZE, PHOTO_COUNT)}/${PHOTO_COUNT} images`,
        );
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log(`Image generation completed in ${duration.toFixed(1)}s`);
  }, 600000); // 10分のタイムアウト

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // 環境変数を復元
    process.env = originalEnv;

    // DBをクリーンアップ
    await client.__cleanupTestRDBClient();

    // テスト用ディレクトリを削除
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
      console.log('Cleaned up test directory');
    }
  });

  it('createVRChatPhotoPathIndex のメモリ使用量を計測', async () => {
    // サービス関数を動的インポート
    const { createVRChatPhotoPathIndex, getVRChatPhotoDirPath } = await import(
      './vrchatPhoto.service'
    );

    // 前回のスキャン状態をクリア（初回起動をシミュレート）
    photoFolderScanStates = {};

    console.log('\n=== Starting Photo Index Creation ===');
    console.log(`Photos directory: ${getVRChatPhotoDirPath().value}`);

    // メモリスナップショットを収集
    const snapshots: MemorySnapshot[] = [];
    snapshots.push(takeMemorySnapshot('before_indexing'));

    // メモリ監視のインターバル
    const monitoringInterval = setInterval(() => {
      snapshots.push(takeMemorySnapshot(`during_indexing_${snapshots.length}`));
    }, 1000);

    const startTime = Date.now();

    try {
      // 初回スキャン（isIncremental = false）
      const result = await createVRChatPhotoPathIndex(false);

      const duration = (Date.now() - startTime) / 1000;
      console.log(`\nIndexing completed in ${duration.toFixed(1)}s`);
      console.log(`Indexed photos: ${result.length}`);
    } finally {
      clearInterval(monitoringInterval);
    }

    snapshots.push(takeMemorySnapshot('after_indexing'));

    // GC後のメモリを計測
    if (global.gc) {
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 500));
      snapshots.push(takeMemorySnapshot('after_gc'));
    }

    // レポートを生成
    const report = generateMemoryReport(snapshots);

    console.log('\n=== Memory Profiling Report ===');
    console.log(`Sample count: ${report.snapshots.length}`);
    console.log(`Peak RSS: ${report.peakRss.toFixed(2)} MB`);
    console.log(`Peak Heap: ${report.peakHeap.toFixed(2)} MB`);
    console.log(`Memory Growth: ${report.memoryGrowth.toFixed(2)} MB`);

    // メモリタイムライン
    console.log('\n--- Memory Timeline ---');
    for (const snapshot of report.snapshots) {
      console.log(
        `[${snapshot.label}] RSS: ${snapshot.rssMB.toFixed(2)}MB, Heap: ${snapshot.heapUsedMB.toFixed(2)}MB`,
      );
    }

    // 問題の検出
    console.log('\n=== Issue Detection ===');

    const rssPerPhoto = report.peakRss / PHOTO_COUNT;
    console.log(`RSS per photo: ${(rssPerPhoto * 1024).toFixed(2)} KB`);

    if (report.peakRss > 1024) {
      console.log(
        `⚠️ WARNING: Peak RSS exceeds 1GB (${report.peakRss.toFixed(2)}MB)`,
      );
    }

    if (report.memoryGrowth > 500) {
      console.log(
        `⚠️ WARNING: Memory growth exceeds 500MB (${report.memoryGrowth.toFixed(2)}MB)`,
      );
    }

    // 10万枚に外挿した場合の予測
    const estimatedRssFor100k = rssPerPhoto * 100000;
    console.log(`\n--- Extrapolation for 100,000 photos ---`);
    console.log(
      `Estimated Peak RSS: ${(estimatedRssFor100k / 1024).toFixed(2)} GB`,
    );

    if (estimatedRssFor100k > 4096) {
      console.log(
        `⚠️ CRITICAL: Estimated RSS for 100k photos exceeds 4GB - likely to cause OOM on typical systems`,
      );
    } else if (estimatedRssFor100k > 2048) {
      console.log(
        `⚠️ WARNING: Estimated RSS for 100k photos exceeds 2GB - may cause issues on low-memory systems`,
      );
    } else {
      console.log(`✅ Estimated RSS is acceptable for 100k photos`);
    }

    // アサーション
    expect(report.peakRss).toBeLessThan(2048); // 2GB未満
  }, 600000); // 10分のタイムアウト

  it('Sharp設定の影響を比較テスト', async () => {
    // 前回のスキャン状態をクリア
    photoFolderScanStates = {};

    console.log('\n=== Sharp Configuration Comparison ===');

    const configurations = [
      { name: 'Default', setup: () => {} },
      {
        name: 'Cache disabled',
        setup: () => {
          sharp.cache(false);
        },
      },
      {
        name: 'Concurrency=1',
        setup: () => {
          sharp.concurrency(1);
        },
      },
      {
        name: 'Cache=50MB, Concurrency=2',
        setup: () => {
          sharp.cache({ memory: 50, files: 20, items: 100 });
          sharp.concurrency(2);
        },
      },
    ];

    for (const config of configurations) {
      // 設定を適用
      config.setup();

      // スキャン状態をリセット
      photoFolderScanStates = {};

      // DBをリセット
      await client.__forceSyncRDBClient();

      const snapshot1 = takeMemorySnapshot('before');

      const { createVRChatPhotoPathIndex } = await import(
        './vrchatPhoto.service'
      );
      await createVRChatPhotoPathIndex(false);

      const snapshot2 = takeMemorySnapshot('after');

      const growth = snapshot2.rssMB - snapshot1.rssMB;
      console.log(
        `[${config.name}] RSS Growth: ${growth.toFixed(2)}MB, Peak: ${snapshot2.rssMB.toFixed(2)}MB`,
      );

      // デフォルトに戻す
      sharp.cache({ memory: 50, files: 20, items: 200 });
      sharp.concurrency(0);
    }
  }, 600000);
});
