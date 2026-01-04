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
  photosLoaded: boolean;
  contentLoadTime: number | null;
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
      '--enable-logging',
      '--log-level=0',
      // Disable crash reporter to prevent GLib-GObject errors from killing the process
      '--disable-breakpad',
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
      // Prevent Electron from creating native dialogs that may cause GTK issues
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      // Disable hardware acceleration to avoid GPU-related crashes
      ELECTRON_DISABLE_GPU: '1',
      // Force libvips to use single thread to avoid GObject conflicts with GTK
      VIPS_CONCURRENCY: '1',
      // Disable GTK accessibility to prevent D-Bus issues
      GTK_A11Y: 'none',
      NO_AT_BRIDGE: '1',
      // Prevent Glib extra module loading
      GIO_EXTRA_MODULES: '',
      // Suppress GTK warning messages
      GTK_DEBUG: 'no-css-validation',
      // libvips settings to avoid GLib-GObject conflicts
      VIPS_MAX_THREADS: '1',
      VIPS_NOVECTOR: '1',
      // Force Sharp to use bundled libvips (avoids system libvips/GTK conflicts)
      SHARP_IGNORE_GLOBAL_LIBVIPS: '1',
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
 * 写真一覧のロードが正常に完了することを検証するテスト
 *
 * このテストは以下を検証します：
 * 1. アプリが正常に起動すること
 * 2. 写真一覧が妥当な時間内にロードされること
 *
 * 注意: React StrictModeと tRPC クエリの状態遷移により、
 * コンポーネントは複数回レンダリングされますが、
 * useMemoによるメモ化で重い処理は最小限に抑えられています。
 */
test('写真一覧が正常にロードされる', async () => {
  console.log('=== Photo Loading Performance Debug Test ===');

  // テスト用の写真ディレクトリをセットアップ
  setupTestPhotos();

  const metrics: PerformanceMetrics = {
    photosLoaded: false,
    contentLoadTime: null,
  };

  // Launch Electron app
  console.log('Launching Electron app...');
  const electronApp = await launchElectronApp();
  console.log('Electron app launched, PID:', electronApp.process().pid);
  console.log('Waiting for first window...');

  try {
    const page = await electronApp.firstWindow({ timeout: 30000 });
    console.log('First window obtained, URL:', await page.url());
  } catch (e) {
    console.error('Failed to get first window:', e);
    throw e;
  }
  const page = await electronApp.firstWindow({ timeout: 1000 }); // Already got it, quick retry

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
    metrics.contentLoadTime = Date.now() - startTime;
    metrics.photosLoaded = true;
    console.log(
      `\n=== Main content loaded in ${metrics.contentLoadTime}ms ===`,
    );
  } catch (_error) {
    metrics.contentLoadTime = Date.now() - startTime;
    console.log(`\n=== Timeout after ${metrics.contentLoadTime}ms ===`);

    // タイムアウト時もスクリーンショットを撮る
    if (!page.isClosed()) {
      await page.screenshot({
        path: path.join(__dirname, './previews/photo-loading-timeout.png'),
      });
    }
  }

  // メトリクスを出力
  console.log('\n=== Performance Metrics ===');
  console.log(`Photos loaded: ${metrics.photosLoaded}`);
  console.log(`Content load time: ${metrics.contentLoadTime}ms`);

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
  // 写真がロードされていることを確認
  expect(metrics.photosLoaded).toBe(true);
  // ロード時間が妥当な範囲内であることを確認（60秒以内）
  expect(metrics.contentLoadTime).toBeLessThan(60000);

  console.log('\n=== Test Complete ===');
});
