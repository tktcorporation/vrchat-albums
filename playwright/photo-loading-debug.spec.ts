import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test } from '@playwright/test';

// ESモジュール環境で__dirnameの代わりに使用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * テスト用の写真ディレクトリをセットアップする
 * debug/VRChat_2023-10-01_03-01-18.551_2560x1440_sample.png を
 * debug/photos/VRChat/2023-10/ にコピーする
 */
const setupTestPhotos = () => {
  const samplePhotoPath = path.join(
    __dirname,
    '../debug/VRChat_2023-10-01_03-01-18.551_2560x1440_sample.png',
  );
  const targetDir = path.join(__dirname, '../debug/photos/VRChat/2023-10');
  const targetPhotoPath = path.join(
    targetDir,
    'VRChat_2023-10-08_00-05-00.000_2560x1440.png',
  );

  // ディレクトリを作成（存在しない場合）
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`Created test photos directory: ${targetDir}`);
  }

  // サンプル画像をコピー（存在しない場合）
  if (!fs.existsSync(targetPhotoPath)) {
    fs.copyFileSync(samplePhotoPath, targetPhotoPath);
    console.log(`Copied sample photo to: ${targetPhotoPath}`);
  }
};

// Constants
const XVFB_STARTUP_DELAY_MS = 1000;
const SERVER_CHECK_INTERVAL_MS = 1000;
const SERVER_MAX_ATTEMPTS = 10;
const MEMORY_LIMIT_MB = process.env.PLAYWRIGHT_MAX_MEMORY || '4096';

interface PerformanceMetrics {
  usePhotoGalleryCallCount: number;
  useGroupPhotosCallCount: number;
  groupPhotosBySessionTime: number | null;
  convertGroupsToRecordTime: number | null;
  photosLength: number | null;
  joinLogsLength: number | null;
  groupCount: number | null;
}

const launchElectronApp = async () => {
  const { execSync } = await import('node:child_process');
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
    },
  });

  electronApp.process().stdout?.on('data', (data) => {
    console.log(`[Electron stdout] ${data}`);
  });

  electronApp.process().stderr?.on('data', (data) => {
    console.error(`[Electron stderr] ${data}`);
  });

  return electronApp;
};

const TIMEOUT = 120000; // 2 minutes for debugging

test.setTimeout(TIMEOUT);

/**
 * 写真一覧の無限ロード問題をデバッグするテスト
 *
 * このテストは以下を検証します：
 * 1. usePhotoGallery が何回呼ばれるか（2回呼ばれている問題）
 * 2. groupPhotosBySession の処理時間
 * 3. 写真とログの件数
 */
test('写真一覧のロードパフォーマンスを計測', async () => {
  console.log('=== Photo Loading Performance Debug Test ===');

  // テスト用の写真ディレクトリをセットアップ
  setupTestPhotos();

  const metrics: PerformanceMetrics = {
    usePhotoGalleryCallCount: 0,
    useGroupPhotosCallCount: 0,
    groupPhotosBySessionTime: null,
    convertGroupsToRecordTime: null,
    photosLength: null,
    joinLogsLength: null,
    groupCount: null,
  };

  // Launch Electron app
  console.log('Launching Electron app...');
  const electronApp = await launchElectronApp();
  console.log('Electron app launched, waiting for first window...');

  const page = await electronApp.firstWindow({ timeout: 30000 });

  // コンソールログを監視してメトリクスを収集
  page.on('console', (msg) => {
    const text = msg.text();

    // usePhotoGallery の呼び出し回数をカウント
    if (text.includes('[usePhotoGallery] Hook called')) {
      metrics.usePhotoGalleryCallCount++;
      console.log(
        `[DEBUG] usePhotoGallery called (count: ${metrics.usePhotoGalleryCallCount})`,
      );
      console.log(`[DEBUG] ${text}`);
    }

    // useGroupPhotos の呼び出し回数をカウント
    if (text.includes('[useGroupPhotos] useMemo triggered')) {
      metrics.useGroupPhotosCallCount++;
      console.log(
        `[DEBUG] useGroupPhotos triggered (count: ${metrics.useGroupPhotosCallCount})`,
      );

      // photosLength と joinLogsLength を抽出
      const photosMatch = text.match(/photosLength:\s*(\d+)/);
      const logsMatch = text.match(/joinLogsLength:\s*(\d+)/);
      if (photosMatch) {
        metrics.photosLength = Number.parseInt(photosMatch[1], 10);
      }
      if (logsMatch) {
        metrics.joinLogsLength = Number.parseInt(logsMatch[1], 10);
      }
      console.log(`[DEBUG] ${text}`);
    }

    // groupPhotosBySession の処理時間を抽出
    if (text.includes('[useGroupPhotos] groupPhotosBySession:')) {
      const timeMatch = text.match(/groupPhotosBySession:\s*([\d.]+)ms/);
      if (timeMatch) {
        metrics.groupPhotosBySessionTime = Number.parseFloat(timeMatch[1]);
        console.log(
          `[DEBUG] groupPhotosBySession took ${metrics.groupPhotosBySessionTime}ms`,
        );
      }
    }

    // convertGroupsToRecord の処理時間を抽出
    if (text.includes('[useGroupPhotos] convertGroupsToRecord:')) {
      const timeMatch = text.match(/convertGroupsToRecord:\s*([\d.]+)ms/);
      if (timeMatch) {
        metrics.convertGroupsToRecordTime = Number.parseFloat(timeMatch[1]);
        console.log(
          `[DEBUG] convertGroupsToRecord took ${metrics.convertGroupsToRecordTime}ms`,
        );
      }
    }

    // Grouping complete からグループ数を抽出
    if (text.includes('[useGroupPhotos] Grouping complete')) {
      const groupMatch = text.match(/groupCount:\s*(\d+)/);
      if (groupMatch) {
        metrics.groupCount = Number.parseInt(groupMatch[1], 10);
        console.log(
          `[DEBUG] Grouping complete with ${metrics.groupCount} groups`,
        );
      }
    }

    // GalleryContent のレンダリングログ
    if (text.includes('[GalleryContent] Render')) {
      console.log(`[DEBUG] ${text}`);
    }
  });

  // ページエラーを監視
  page.on('pageerror', (error) => {
    console.error('[Page Error]', error.message);
  });

  // 開発サーバーが完全に起動するまで待つ
  await page.waitForTimeout(5000);

  // 「同意する」が表示されればクリック
  await page.waitForTimeout(1000);
  const isTermsButtonVisible = await page.isVisible('text=同意する');
  if (isTermsButtonVisible) {
    console.log('Terms button found, clicking...');
    await page.click('text=同意する');
    await page.waitForTimeout(1000);
  }

  // セットアップ画面かメイン画面を待つ
  await page.waitForTimeout(2000);

  // 入力フィールドがあるか確認
  const hasInput = (await page.locator('input[type="text"]').count()) > 0;
  if (hasInput) {
    console.log('Found input fields, configuring paths...');

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
      await page.keyboard.type(path.join(__dirname, '../debug/photos/VRChat'));
      const photoSubmitButton = await page.waitForSelector(
        '[aria-label="送信-写真ディレクトリ"]',
      );
      await photoSubmitButton.click();

      // 設定を確認して続ける
      const setupButton = await page.waitForSelector(
        'text=設定を確認して続ける',
      );
      await setupButton.click();

      console.log('Waiting for setup to complete...');
      await page.waitForTimeout(3000);
    } catch (error) {
      console.log('Setup fields not found or error:', error);
    }
  }

  // メインコンテンツのロードを待つ
  console.log('Waiting for main content to load...');
  const startTime = Date.now();

  try {
    await page.waitForSelector(
      '[data-testid="location-group-header"], .photo-card',
      { timeout: 60000 },
    );
    const loadTime = Date.now() - startTime;
    console.log(`\n=== Main content loaded in ${loadTime}ms ===`);
  } catch (_error) {
    const loadTime = Date.now() - startTime;
    console.log(`\n=== Timeout after ${loadTime}ms ===`);

    // タイムアウト時もメトリクスを出力
    if (!page.isClosed()) {
      await page.screenshot({
        path: path.join(__dirname, './previews/photo-loading-timeout.png'),
      });
    }
  }

  // さらに少し待ってメトリクスを収集
  await page.waitForTimeout(5000);

  // メトリクスを出力
  console.log('\n=== Performance Metrics ===');
  console.log(
    `usePhotoGallery call count: ${metrics.usePhotoGalleryCallCount}`,
  );
  console.log(`useGroupPhotos call count: ${metrics.useGroupPhotosCallCount}`);
  console.log(`Photos count: ${metrics.photosLength ?? 'N/A'}`);
  console.log(`Join logs count: ${metrics.joinLogsLength ?? 'N/A'}`);
  console.log(`Group count: ${metrics.groupCount ?? 'N/A'}`);
  console.log(
    `groupPhotosBySession time: ${metrics.groupPhotosBySessionTime ?? 'N/A'}ms`,
  );
  console.log(
    `convertGroupsToRecord time: ${metrics.convertGroupsToRecordTime ?? 'N/A'}ms`,
  );

  // 問題の検証
  console.log('\n=== Issues Detection ===');

  // Issue 1: usePhotoGallery が2回以上呼ばれている
  if (metrics.usePhotoGalleryCallCount > 1) {
    console.log(
      `⚠️ ISSUE: usePhotoGallery is called ${metrics.usePhotoGalleryCallCount} times (expected: 1)`,
    );
  } else if (metrics.usePhotoGalleryCallCount === 1) {
    console.log('✅ usePhotoGallery is called only once');
  }

  // Issue 2: groupPhotosBySession が遅い（1秒以上）
  if (
    metrics.groupPhotosBySessionTime !== null &&
    metrics.groupPhotosBySessionTime > 1000
  ) {
    console.log(
      `⚠️ ISSUE: groupPhotosBySession is slow (${metrics.groupPhotosBySessionTime}ms > 1000ms)`,
    );
  } else if (metrics.groupPhotosBySessionTime !== null) {
    console.log(
      `✅ groupPhotosBySession is fast (${metrics.groupPhotosBySessionTime}ms)`,
    );
  }

  // スクリーンショットを保存
  if (!page.isClosed()) {
    await page.screenshot({
      path: path.join(__dirname, './previews/photo-loading-final.png'),
    });
  }

  // アプリを終了
  try {
    await electronApp.close();
  } catch {
    console.log('App already closed');
  }

  // テスト結果を検証
  // usePhotoGallery が2回以上呼ばれている場合は警告（テストは失敗させない）
  expect(metrics.usePhotoGalleryCallCount).toBeGreaterThan(0);

  console.log('\n=== Test Complete ===');
});
