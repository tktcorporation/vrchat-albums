import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, _electron, expect, test } from '@playwright/test';
import consola from 'consola';

// ESモジュール環境で__dirnameの代わりに使用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const launchElectronApp = async () => {
  // Start Xvfb if not running
  const { execSync } = await import('node:child_process');
  try {
    execSync('pidof Xvfb', { stdio: 'ignore' });
    console.log('Xvfb is already running');
  } catch {
    console.log('Starting Xvfb...');
    execSync('Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &', {
      shell: '/bin/bash',
    });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for Xvfb to start
  }

  // 開発サーバーが起動するまで待つ（Playwrightのwebserver設定が処理する）
  // ただし、念のため確認する
  const waitForServer = async (url: string, maxAttempts = 10) => {
    console.log('Checking if development server is ready...');
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(url);
        if (response.ok || response.status === 304) {
          console.log('Development server is ready');
          return true;
        }
      } catch (_error) {
        // サーバーがまだ起動していない
        console.log(`Waiting for server... (attempt ${i + 1}/${maxAttempts})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // webServerの設定があるので、サーバーは起動しているはず
    console.warn('Could not verify development server, but proceeding anyway');
    return true;
  };

  // 開発サーバーの起動を確認（オプショナル）
  await waitForServer('http://localhost:3000');

  // Launch Electron app with increased memory
  const electronApp = await _electron.launch({
    args: [
      '--no-sandbox',
      '--max-old-space-size=4096', // Node.jsのヒープメモリを4GBに増やす
      '--js-flags=--max-old-space-size=4096', // V8エンジンのメモリ制限を増やす
      '--disable-dev-shm-usage', // /dev/shmの使用を無効化（コンテナ環境向け）
      '--disable-gpu', // GPU無効化でメモリ節約
      '--disable-software-rasterizer',
      '--disable-features=VizDisplayCompositor', // Disable problematic display features
      '--disable-gpu-compositing',
      '--in-process-gpu', // Run GPU in process to avoid IPC issues
      '--enable-logging', // Enable logging
      '--log-level=0', // Verbose logging
      path.join(__dirname, '../main/index.cjs'),
    ],
    env: {
      ...process.env,
      PLAYWRIGHT_TEST: 'true',
      PLAYWRIGHT_STORE_HASH: Date.now().toString(),
      NODE_ENV: 'development', // 開発モードを強制
      PORT: '3000', // 開発サーバーのポート
      NODE_OPTIONS: '--max-old-space-size=4096', // Node.js環境変数でもメモリ制限を設定
      ELECTRON_ENABLE_LOGGING: '1', // Enable Electron logging
      G_SLICE: 'always-malloc', // Fix GLib memory issues
      GTK_THEME: 'Adwaita', // Set a default GTK theme
      DISPLAY: ':99', // Virtual display
    },
  });

  // Capture process output
  electronApp.process().stdout?.on('data', (data) => {
    console.log(`[Electron stdout] ${data}`);
  });

  electronApp.process().stderr?.on('data', (data) => {
    console.error(`[Electron stderr] ${data}`);
  });

  return electronApp;
};

const screenshotPath = (title: string, suffix: string) => {
  return path.join(__dirname, './previews', `${title}-${suffix}.png`);
};

// スクリーンショット撮影の成功を追跡（テストごとにリセット）
let screenshotsTaken: Set<string>;

const screenshot = async (page: Page, title: string, suffix: string) => {
  const filePath = screenshotPath(title, suffix);
  try {
    await page.screenshot({ path: filePath });
    const now = new Date().toISOString().split('T')[1].split('.')[0];
    consola.log(`[${now}]: screenshot: ${filePath}`);
    screenshotsTaken.add(suffix);
  } catch (error) {
    console.error(`Failed to take screenshot ${suffix}:`, error);
    throw new Error(`Screenshot failed: ${suffix}`);
  }
};

const TIMEOUT = 60000; // Increased timeout to 60 seconds

test.setTimeout(TIMEOUT);

test('各画面でスクショ', async () => {
  // スクリーンショット追跡をリセット
  screenshotsTaken = new Set();

  // Launch Electron app.
  console.log('Launching Electron app...');
  const electronApp = await launchElectronApp();
  console.log('Electron app launched, waiting for first window...');

  // Get the first window that the app opens, wait if necessary.
  const page = await electronApp.firstWindow({ timeout: 30000 });

  // 開発サーバーが完全に起動するまで待つ
  await page.waitForTimeout(5000);

  // Listen for console messages
  page.on('console', (msg) => {
    const text = msg.text();
    // Filter out noisy messages
    if (!text.includes('Download the React DevTools')) {
      console.log(`[${msg.type()}] ${text}`);
    }
  });

  // Listen for page errors
  page.on('pageerror', (error) => {
    console.error('[Page Error]', error.message);
    console.error(error.stack);
  });

  // Listen for request failures
  page.on('requestfailed', (request) => {
    console.error(
      '[Request Failed]',
      request.url(),
      request.failure()?.errorText,
    );
  });

  // Listen for uncaught exceptions in the main process
  electronApp.on('window', async (window) => {
    window.on('console', (msg) => {
      console.log(`[Main Process] ${msg.text()}`);
    });
  });

  // Listen for page close events
  page.on('close', () => {
    console.error('[Page Closed] The page was closed unexpectedly');
  });

  // Listen for crashes
  page.on('crash', () => {
    console.error('[Page Crashed] The page crashed');
  });

  const title = await page.title();

  // Print the title.
  console.log(title);

  // await page.evaluate((routerPath) => {
  //   window.history.pushState({}, '', routerPath);
  //   window.location.href = `#${routerPath}`;
  // }, routerPath);

  // タイムアウト処理の調整
  const timeoutDecreaseTwo = TIMEOUT - 5000;
  Promise.race([
    new Promise((resolve) => setTimeout(resolve, timeoutDecreaseTwo)),
    new Promise((_resolve, reject) => {
      setTimeout(async () => {
        await screenshot(page, title, 'timeout');
        reject(new Error('Timeout'));
      }, timeoutDecreaseTwo);
    }),
  ]);

  await screenshot(page, title, 'initial');

  // 「同意する」が表示されればクリック、表示されなければ次へ進む
  await page.waitForTimeout(1000);
  const isTermsButtonVisible = await page.isVisible('text=同意する');
  if (isTermsButtonVisible) {
    console.log('Terms button found, clicking...');
    await screenshot(page, title, 'terms');
    await page.click('text=同意する');
    await page.waitForTimeout(1000);
  } else {
    consola.log('「同意する」ボタンが表示されていません');
  }

  // 初期セットアップ画面または既にセットアップ済みの画面を待つ
  console.log('Waiting for setup or main screen...');

  // ページの内容をデバッグのために取得
  await page.waitForTimeout(2000); // Wait for content to load
  const pageText = await page.textContent('body');
  console.log('Page content preview:', pageText?.substring(0, 200));

  // スクリーンショットを取得してデバッグ
  await screenshot(page, title, 'debug-current-state');

  // 様々な可能性のあるセレクタを試す
  const possibleSelectors = [
    'text=初期セットアップ',
    'text=Initial Setup',
    'text=VRChatログファイルディレクトリ',
    '[aria-label*="VRChat"]',
    'input[type="text"]',
    'button',
    '.setup-container',
    '[data-testid="location-group-header"]',
    '.photo-card',
  ];

  let foundSelector = null;
  for (const selector of possibleSelectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      console.log(`Found selector: ${selector} (count: ${count})`);
      foundSelector = selector;
      break;
    }
  }

  if (!foundSelector) {
    console.log(
      'No expected selectors found, waiting for any input or button...',
    );
    await page.waitForSelector('input, button', { timeout: 5000 });
  }

  // 入力フィールドがあるか確認
  const hasInput = (await page.locator('input[type="text"]').count()) > 0;
  if (hasInput) {
    console.log('Found input fields, assuming setup screen');
    await screenshot(page, title, 'setup');
  } else {
    // メイン画面の可能性
    const hasMainContent =
      (await page
        .locator('[data-testid="location-group-header"], .photo-card')
        .count()) > 0;
    if (hasMainContent) {
      console.log('Main screen already loaded, skipping setup');
      await screenshot(page, title, 'main-already-loaded');
      // Exit app.
      await electronApp.close();
      return;
    }
  }

  // VRChatログファイルディレクトリの入力フィールドを選択
  try {
    const logFileInput = await page.waitForSelector(
      '[aria-label="input-VRChatログファイルディレクトリ"]',
      { timeout: 5000 },
    );
    await logFileInput.click();
    // まず全部消す
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    // パスを入力
    await page.keyboard.type(path.join(__dirname, '../debug/logs'));
    const submitButton = await page.waitForSelector(
      '[aria-label="送信-VRChatログファイルディレクトリ"]',
    );
    await submitButton.click();

    // 写真ディレクトリも設定
    const photoFileInput = await page.waitForSelector(
      '[aria-label="input-写真ディレクトリ"]',
    );
    await photoFileInput.click();
    // まず全部消す
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    // パスを入力
    await page.keyboard.type(path.join(__dirname, '../debug/photos/VRChat'));
    const photoSubmitButton = await page.waitForSelector(
      '[aria-label="送信-写真ディレクトリ"]',
    );
    await photoSubmitButton.click();

    const 設定を確認して続けるButton = await page.waitForSelector(
      'text=設定を確認して続ける',
    );

    // クリック前にページのクローズイベントをリッスン
    let pageClosedDuringSetup = false;
    page.once('close', () => {
      console.error(
        '[CRITICAL] Page closed immediately after clicking setup button',
      );
      pageClosedDuringSetup = true;
    });

    await 設定を確認して続けるButton.click();

    // 設定送信後の処理を待つ
    console.log('Waiting for setup to complete...');

    // ページがすぐに閉じた場合のチェック
    if (pageClosedDuringSetup) {
      throw new Error(
        'Page closed immediately after setup button click - likely a crash during initialization',
      );
    }

    // 短い待機でページの状態を確認
    await page.waitForTimeout(500);

    if (page.isClosed()) {
      throw new Error('Page closed during setup initialization');
    }

    await page.waitForTimeout(2500); // 残りの待機時間
  } catch (error) {
    console.log('Setup fields not found, app might be already configured');
    console.log('Error:', error);
  }

  // データ処理完了まで待機（LocationGroupHeaderが表示されるまで）
  // LocationGroupHeaderまたは写真が表示されるまで待つ
  try {
    console.log('Waiting for main content to load...');
    await page.waitForSelector(
      '[data-testid="location-group-header"], .photo-card',
      { timeout: 30000 }, // タイムアウトを延長
    );
    await screenshot(page, title, 'logs-loaded');

    // 最後の状態をスクショ
    await page.waitForTimeout(500);
    await screenshot(page, title, 'finalized');
  } catch (error) {
    console.log('Failed to wait for main content, checking page status...');

    // ページがまだ開いているか確認
    const isPageClosed = page.isClosed();
    if (isPageClosed) {
      // ページがクローズされるのは異常
      throw new Error(
        'Page was unexpectedly closed during test execution (possibly due to memory issues)',
      );
    }
    // ページが開いているのにセレクタが見つからない場合もエラー
    throw new Error(
      `Failed to find main content selector after setup: ${error}`,
    );
  }

  // Exit app.
  try {
    await electronApp.close();
  } catch {
    console.log('App already closed');
  }

  // テスト終了時に必要なスクリーンショットがすべて撮影されたことを確認
  console.log('\n=== Verifying screenshots ===');
  const requiredScreenshots = [
    'initial',
    'terms',
    'debug-current-state',
    'setup',
    'logs-loaded', // データ処理後の画面
    'finalized', // 最終状態
  ];

  for (const name of requiredScreenshots) {
    if (!screenshotsTaken.has(name)) {
      throw new Error(`Required screenshot was not taken: ${name}`);
    }

    // ファイルも確認
    const screenshotFile = screenshotPath(title, name);
    const exists = fs.existsSync(screenshotFile);
    if (!exists) {
      throw new Error(
        `Screenshot file missing despite successful capture: ${name}`,
      );
    }
    const stats = fs.statSync(screenshotFile);
    expect(stats.size).toBeGreaterThan(0);
    console.log(`✅ ${name}: ${(stats.size / 1024).toFixed(1)} KB`);
  }

  console.log(
    `=== All ${requiredScreenshots.length} required screenshots successfully taken ===\n`,
  );
});
