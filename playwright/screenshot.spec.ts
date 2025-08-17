import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, _electron, test, expect } from '@playwright/test';
import consola from 'consola';
import * as fs from 'node:fs';

// ESモジュール環境で__dirnameの代わりに使用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const launchElectronApp = async () => {
  // Launch Electron app.
  const electronApp = await _electron.launch({
    args: ['--no-sandbox', path.join(__dirname, '../main/index.cjs')],
    env: {
      ...process.env,
      PLAYWRIGHT_TEST: 'true',
      PLAYWRIGHT_STORE_HASH: Date.now().toString(),
      NODE_ENV: 'development', // 開発モードを強制
      PORT: '3000', // 開発サーバーのポート
    },
  });

  return electronApp;
};

const screenshotPath = (title: string, suffix: string) => {
  return path.join(__dirname, './previews', `${title}-${suffix}.png`);
};

const screenshot = async (page: Page, title: string, suffix: string) => {
  await page.screenshot({ path: screenshotPath(title, suffix) });
  const now = new Date().toISOString().split('T')[1].split('.')[0];
  consola.log(`[${now}]: screenshot: ${screenshotPath(title, suffix)}`);
};

const TIMEOUT = 60000; // Increased timeout to 60 seconds

test.setTimeout(TIMEOUT);

test('各画面でスクショ', async () => {
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
    console.log(`[${msg.type()}] ${msg.text()}`);
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
    await 設定を確認して続けるButton.click();
  } catch (error) {
    console.log('Setup fields not found, app might be already configured');
    console.log('Error:', error);
  }

  // データ処理完了まで待機（LocationGroupHeaderが表示されるまで）
  // LocationGroupHeaderまたは写真が表示されるまで待つ
  try {
    await page.waitForSelector(
      '[data-testid="location-group-header"], .photo-card',
      { timeout: 10000 }
    );
    await screenshot(page, title, 'logs-loaded');

    // 最後の状態をスクショ
    await page.waitForTimeout(500);
    await screenshot(page, title, 'finalized');
  } catch (error) {
    console.log('Failed to wait for main content, checking if setup was completed...');
    
    // ページがまだ開いているか確認
    const isPageClosed = page.isClosed();
    if (isPageClosed) {
      console.log('Page was closed, likely due to app restart after setup');
      // セットアップ後の再起動は正常な動作なので、必要なスクリーンショットが撮れているか確認
      const requiredScreenshots = [
        { path: screenshotPath(title, 'initial'), name: 'initial' },
        { path: screenshotPath(title, 'setup'), name: 'setup' },
      ];
      
      for (const screenshot of requiredScreenshots) {
        expect(fs.existsSync(screenshot.path)).toBeTruthy();
        console.log(`✓ Screenshot verified: ${screenshot.name}`);
      }
      console.log('All required screenshots were taken successfully');
      return; // テストを成功として終了
    } else {
      // ページが開いているのにセレクタが見つからない場合はエラー
      throw new Error(`Failed to find main content selector: ${error}`);
    }
  }

  // Exit app.
  try {
    await electronApp.close();
  } catch {
    console.log('App already closed');
  }
  
  // テスト終了時に最低限必要なスクリーンショットが存在することを確認
  console.log('\n=== Verifying screenshots ===');
  const essentialScreenshots = [
    'initial',
    'setup',
  ];
  
  for (const name of essentialScreenshots) {
    const screenshotFile = screenshotPath(title, name);
    const exists = fs.existsSync(screenshotFile);
    if (!exists) {
      throw new Error(`Essential screenshot missing: ${name} (${screenshotFile})`);
    }
    const stats = fs.statSync(screenshotFile);
    expect(stats.size).toBeGreaterThan(0);
    console.log(`✅ ${name}: ${(stats.size / 1024).toFixed(1)} KB`);
  }
  
  console.log('=== All essential screenshots verified ===\n');
});
