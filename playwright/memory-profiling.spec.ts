/**
 * 初回起動時のメモリプロファイリングテスト
 *
 * このテストは大量の写真がある状況でのアプリ起動時のメモリ使用量を計測します。
 * Electronメインプロセスのメモリ使用量をリアルタイムで監視します。
 *
 * 実行方法:
 *   yarn test:playwright playwright/memory-profiling.spec.ts
 *
 * テスト用の大量写真を生成して実行:
 *   GENERATE_TEST_PHOTOS=500 yarn test:playwright playwright/memory-profiling.spec.ts
 */

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const XVFB_STARTUP_DELAY_MS = 1000;
const SERVER_CHECK_INTERVAL_MS = 1000;
const SERVER_MAX_ATTEMPTS = 10;
const MEMORY_LIMIT_MB = process.env.PLAYWRIGHT_MAX_MEMORY || '4096';
const MEMORY_SAMPLE_INTERVAL_MS = 500;

// 生成するテスト写真の枚数（環境変数で上書き可能）
const TEST_PHOTO_COUNT = Number.parseInt(
  process.env.GENERATE_TEST_PHOTOS || '100',
  10,
);

interface MemorySample {
  timestamp: number;
  rssMB: number;
  heapUsedMB: number;
  externalMB: number;
  label: string;
}

interface MemoryReport {
  samples: MemorySample[];
  peakRss: number;
  peakHeap: number;
  avgRss: number;
  memoryGrowth: number;
  duration: number;
}

/**
 * プロセスのメモリ使用量を取得（Linuxの場合はprocから、それ以外はpsコマンドで）
 */
const getProcessMemory = async (
  pid: number,
): Promise<{ rss: number; heap: number; external: number } | null> => {
  try {
    if (process.platform === 'linux') {
      // /proc/[pid]/statmから取得（より正確）
      const statm = await fs.readFile(`/proc/${pid}/statm`, 'utf-8');
      const [_size, resident] = statm.split(' ').map(Number);
      const pageSize = 4096; // Linux default page size
      return {
        rss: (resident * pageSize) / 1024 / 1024,
        heap: 0, // procからは取得困難
        external: 0,
      };
    }
    // macOS/Windowsの場合
    const { execSync } = childProcess;
    const output = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf-8' });
    const rss = Number.parseInt(output.trim(), 10) / 1024; // KB to MB
    return { rss, heap: 0, external: 0 };
  } catch {
    return null;
  }
};

/**
 * メモリ監視を開始
 */
const startMemoryMonitoring = (
  pid: number,
  intervalMs: number,
): { stop: () => MemoryReport; samples: MemorySample[] } => {
  const samples: MemorySample[] = [];
  const startTime = Date.now();

  const intervalId = setInterval(async () => {
    const mem = await getProcessMemory(pid);
    if (mem) {
      samples.push({
        timestamp: Date.now() - startTime,
        rssMB: mem.rss,
        heapUsedMB: mem.heap,
        externalMB: mem.external,
        label: `t+${Math.floor((Date.now() - startTime) / 1000)}s`,
      });
    }
  }, intervalMs);

  const stop = (): MemoryReport => {
    clearInterval(intervalId);

    if (samples.length === 0) {
      return {
        samples: [],
        peakRss: 0,
        peakHeap: 0,
        avgRss: 0,
        memoryGrowth: 0,
        duration: Date.now() - startTime,
      };
    }

    const peakRss = Math.max(...samples.map((s) => s.rssMB));
    const peakHeap = Math.max(...samples.map((s) => s.heapUsedMB));
    const avgRss =
      samples.reduce((sum, s) => sum + s.rssMB, 0) / samples.length;
    const memoryGrowth = samples[samples.length - 1].rssMB - samples[0].rssMB;

    return {
      samples,
      peakRss,
      peakHeap,
      avgRss,
      memoryGrowth,
      duration: Date.now() - startTime,
    };
  };

  return { stop, samples };
};

/**
 * テスト用のダミー写真を生成
 */
const generateTestPhotos = async (
  dir: string,
  count: number,
): Promise<string[]> => {
  const sharp = (await import('sharp')).default;
  const photoPaths: string[] = [];

  console.log(`Generating ${count} test photos in ${dir}...`);

  // VRChatの日付形式でファイル名を生成
  const baseDate = new Date('2024-01-01T12:00:00');

  for (let i = 0; i < count; i++) {
    const date = new Date(baseDate.getTime() + i * 1000);
    const dateStr = date
      .toISOString()
      .replace(/[-:]/g, '-')
      .replace('T', '_')
      .slice(0, 23);
    const fileName = `VRChat_${dateStr.replace(/\./g, '.')}_test${i}.png`;
    const filePath = path.join(dir, fileName);

    // 1920x1080のダミー画像を生成
    await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: {
          r: Math.floor(Math.random() * 255),
          g: Math.floor(Math.random() * 255),
          b: Math.floor(Math.random() * 255),
        },
      },
    })
      .png()
      .toFile(filePath);

    photoPaths.push(filePath);

    if ((i + 1) % 50 === 0) {
      console.log(`Generated ${i + 1}/${count} photos...`);
    }
  }

  console.log(`Generated ${count} test photos`);
  return photoPaths;
};

const launchElectronApp = async () => {
  const { execSync } = childProcess;

  try {
    execSync('pidof Xvfb', { stdio: 'ignore' });
    console.log('Xvfb is already running');
  } catch {
    console.log('Starting Xvfb...');
    execSync('Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &', {
      shell: '/bin/bash',
    });
    await new Promise((resolve) => setTimeout(resolve, XVFB_STARTUP_DELAY_MS));
  }

  const waitForServer = async (
    url: string,
    maxAttempts = SERVER_MAX_ATTEMPTS,
  ) => {
    console.log('Checking if development server is ready...');
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(url);
        if (response.ok || response.status === 304) {
          console.log('Development server is ready');
          return true;
        }
      } catch {
        console.log(`Waiting for server... (attempt ${i + 1}/${maxAttempts})`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SERVER_CHECK_INTERVAL_MS),
      );
    }
    console.warn('Could not verify development server, but proceeding anyway');
    return true;
  };

  await waitForServer('http://localhost:3000');

  const electronApp = await _electron.launch({
    args: [
      '--no-sandbox',
      `--max-old-space-size=${MEMORY_LIMIT_MB}`,
      `--js-flags=--max-old-space-size=${MEMORY_LIMIT_MB}`,
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-features=VizDisplayCompositor',
      '--disable-gpu-compositing',
      '--in-process-gpu',
      '--enable-logging',
      '--log-level=0',
      path.join(__dirname, '../main/index.cjs'),
    ],
    env: {
      ...process.env,
      PLAYWRIGHT_TEST: 'true',
      PLAYWRIGHT_STORE_HASH: Date.now().toString(),
      NODE_ENV: 'development',
      PORT: '3000',
      NODE_OPTIONS: `--max-old-space-size=${MEMORY_LIMIT_MB}`,
      ELECTRON_ENABLE_LOGGING: '1',
      G_SLICE: 'always-malloc',
      G_DEBUG: '',
      GDK_BACKEND: 'x11',
      GTK_THEME: 'Adwaita',
      LIBGL_ALWAYS_SOFTWARE: '1',
      DISPLAY: ':99',
      // libvipsのメモリ設定（環境変数で制御可能）
      VIPS_CONCURRENCY: '2',
      VIPS_DISC_THRESHOLD: '100m',
    },
  });

  return electronApp;
};

const TIMEOUT = 300000; // 5 minutes for memory testing

test.setTimeout(TIMEOUT);

test.describe('初回起動時のメモリプロファイリング', () => {
  let testPhotosDir: string;

  test.beforeAll(async () => {
    // テスト用写真ディレクトリを作成
    testPhotosDir = path.join(__dirname, '../debug/photos/VRChat');
    await fs.mkdir(testPhotosDir, { recursive: true });

    // テスト用ログディレクトリも確認
    const testLogsDir = path.join(__dirname, '../debug/logs');
    await fs.mkdir(testLogsDir, { recursive: true });

    // テスト用写真を生成
    const existingPhotos = await fs.readdir(testPhotosDir).catch(() => []);
    if (existingPhotos.length < TEST_PHOTO_COUNT) {
      console.log(
        `Existing photos: ${existingPhotos.length}, generating ${TEST_PHOTO_COUNT - existingPhotos.length} more...`,
      );
      await generateTestPhotos(
        testPhotosDir,
        TEST_PHOTO_COUNT - existingPhotos.length,
      );
    } else {
      console.log(`Using existing ${existingPhotos.length} test photos`);
    }
  });

  test('初回起動時のメモリ使用量を計測', async () => {
    console.log('=== Memory Profiling Test ===');
    console.log(`Test photo count: ${TEST_PHOTO_COUNT}`);

    // アプリを起動
    console.log('Launching Electron app...');
    const electronApp = await launchElectronApp();
    const mainProcess = electronApp.process();
    const pid = mainProcess.pid;

    if (!pid) {
      throw new Error('Failed to get Electron process PID');
    }

    console.log(`Electron process PID: ${pid}`);

    // メモリ監視を開始
    const memoryMonitor = startMemoryMonitoring(pid, MEMORY_SAMPLE_INTERVAL_MS);

    // メインプロセスのログを監視
    mainProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      if (
        text.includes('memory') ||
        text.includes('Memory') ||
        text.includes('sharp') ||
        text.includes('Sharp')
      ) {
        console.log(`[Electron] ${text.trim()}`);
      }
    });

    mainProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      if (text.includes('error') || text.includes('Error')) {
        console.error(`[Electron Error] ${text.trim()}`);
      }
    });

    // ウィンドウを取得
    console.log('Waiting for first window...');
    const page = await electronApp.firstWindow({ timeout: 60000 });

    // コンソールログを監視
    page.on('console', (msg) => {
      const text = msg.text();
      // 初期化関連のログを出力
      if (
        text.includes('initialization') ||
        text.includes('photo') ||
        text.includes('Photo') ||
        text.includes('batch') ||
        text.includes('Batch')
      ) {
        console.log(`[Page] ${text}`);
      }
    });

    // 利用規約に同意
    await page.waitForTimeout(3000);
    const isTermsVisible = await page.isVisible('text=同意する');
    if (isTermsVisible) {
      console.log('Accepting terms...');
      await page.click('text=同意する');
      await page.waitForTimeout(1000);
    }

    // セットアップ画面でパスを設定
    const hasInput = (await page.locator('input[type="text"]').count()) > 0;
    if (hasInput) {
      console.log('Configuring paths...');

      try {
        // VRChatログファイルディレクトリの入力
        const logFileInput = await page.waitForSelector(
          '[aria-label="input-VRChatログファイルディレクトリ"]',
          { timeout: 5000 },
        );
        await logFileInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await page.keyboard.type(path.join(__dirname, '../debug/logs'));
        const submitButton = await page.waitForSelector(
          '[aria-label="送信-VRChatログファイルディレクトリ"]',
        );
        await submitButton.click();

        // 写真ディレクトリの入力
        const photoFileInput = await page.waitForSelector(
          '[aria-label="input-写真ディレクトリ"]',
        );
        await photoFileInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await page.keyboard.type(testPhotosDir);
        const photoSubmitButton = await page.waitForSelector(
          '[aria-label="送信-写真ディレクトリ"]',
        );
        await photoSubmitButton.click();

        // 設定を確認して続ける
        const setupButton = await page.waitForSelector(
          'text=設定を確認して続ける',
          { timeout: 5000 },
        );
        await setupButton.click();

        console.log('Setup completed, waiting for initialization...');
      } catch (error) {
        console.log('Setup error:', error);
      }
    }

    // 初期化完了を待つ（写真インデックス作成を含む）
    console.log('Waiting for app initialization (photo indexing)...');

    // 最大2分間待機
    const initTimeout = 120000;
    const startTime = Date.now();

    try {
      // メインコンテンツまたはエラーを待つ
      await page.waitForSelector(
        '[data-testid="location-group-header"], .photo-card, [data-testid="error-message"]',
        { timeout: initTimeout },
      );
      console.log(
        `App initialized in ${Math.floor((Date.now() - startTime) / 1000)}s`,
      );
    } catch {
      console.log(`Timeout after ${Math.floor(initTimeout / 1000)}s`);
    }

    // さらに10秒待ってメモリが安定するのを観察
    await page.waitForTimeout(10000);

    // メモリ監視を停止してレポートを生成
    const report = memoryMonitor.stop();

    // レポートを出力
    console.log('\n=== Memory Profiling Report ===');
    console.log(`Duration: ${(report.duration / 1000).toFixed(1)}s`);
    console.log(`Sample count: ${report.samples.length}`);
    console.log(`Peak RSS: ${report.peakRss.toFixed(2)} MB`);
    console.log(`Average RSS: ${report.avgRss.toFixed(2)} MB`);
    console.log(`Memory Growth: ${report.memoryGrowth.toFixed(2)} MB`);

    // メモリサンプルのタイムライン（10サンプルごと）
    console.log('\n--- Memory Timeline ---');
    for (
      let i = 0;
      i < report.samples.length;
      i += Math.max(1, Math.floor(report.samples.length / 10))
    ) {
      const sample = report.samples[i];
      console.log(`[${sample.label}] RSS: ${sample.rssMB.toFixed(2)} MB`);
    }

    // 問題の検出
    console.log('\n=== Issue Detection ===');

    if (report.peakRss > 1024) {
      console.log(
        `⚠️ WARNING: Peak RSS exceeds 1GB (${report.peakRss.toFixed(2)}MB)`,
      );
    } else if (report.peakRss > 512) {
      console.log(
        `⚠️ NOTICE: Peak RSS exceeds 512MB (${report.peakRss.toFixed(2)}MB)`,
      );
    } else {
      console.log(`✅ Peak RSS is acceptable (${report.peakRss.toFixed(2)}MB)`);
    }

    if (report.memoryGrowth > 500) {
      console.log(
        `⚠️ WARNING: Memory growth exceeds 500MB (${report.memoryGrowth.toFixed(2)}MB)`,
      );
    } else {
      console.log(
        `✅ Memory growth is acceptable (${report.memoryGrowth.toFixed(2)}MB)`,
      );
    }

    // スクリーンショットを保存
    if (!page.isClosed()) {
      await page.screenshot({
        path: path.join(__dirname, './previews/memory-profiling-final.png'),
      });
    }

    // アプリを終了
    try {
      await electronApp.close();
    } catch {
      console.log('App already closed');
    }

    // 検証
    // Peak RSSが2GB未満であることを確認（クラッシュ防止の基準）
    expect(report.peakRss).toBeLessThan(2048);

    console.log('\n=== Test Complete ===');
  });
});
