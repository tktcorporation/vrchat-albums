import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';
import consola from 'consola';

// ESモジュール環境で__dirnameの代わりに使用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    throw new Error(`Screenshot failed: ${suffix}`, { cause: error });
  }
};

const TIMEOUT = 60000;

test.setTimeout(TIMEOUT);

test('各画面でスクショ', async ({ page }) => {
  // スクリーンショット追跡をリセット
  screenshotsTaken = new Set();

  // Vite dev サーバーに直接アクセス（playwright.config.ts の webServer が起動）
  console.log('Navigating to Vite dev server...');
  await page.goto('http://localhost:3000');

  const title = (await page.title()) || 'VRChatAlbums';

  // Listen for critical errors only
  page.on('pageerror', (error) => {
    console.error('[Page Error]', error.message);
  });

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

  // Wait for content to load
  await page.waitForTimeout(2000);
  await screenshot(page, title, 'debug-current-state');

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

    // 設定送信後の処理を待つ
    console.log('Waiting for setup to complete...');
    await page.waitForTimeout(3000);
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
      { timeout: 30000 },
    );
    await screenshot(page, title, 'logs-loaded');

    // 最後の状態をスクショ
    await page.waitForTimeout(500);
    await screenshot(page, title, 'finalized');
  } catch (error) {
    console.log('Failed to wait for main content, checking page status...');
    throw new Error(
      `Failed to find main content selector after setup: ${error}`,
      { cause: error },
    );
  }

  // テスト終了時に必要なスクリーンショットがすべて撮影されたことを確認
  console.log('\n=== Verifying screenshots ===');
  const requiredScreenshots = [
    'initial',
    'terms',
    'debug-current-state',
    'setup',
    'logs-loaded',
    'finalized',
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
