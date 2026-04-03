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
    const now = new Date().toISOString().split('T')[1]?.split('.')[0];
    consola.log(`[${now}]: screenshot: ${filePath}`);
    screenshotsTaken.add(suffix);
  } catch (error) {
    console.error(`Failed to take screenshot ${suffix}:`, error);
    throw new Error(`Screenshot failed: ${suffix}`, { cause: error });
  }
};

const TIMEOUT = 60000;

test.setTimeout(TIMEOUT);

/**
 * アプリケーションの各画面でスクリーンショットを撮影する。
 *
 * 背景: Electrobun 移行後は Chromium ブラウザ + Vite dev サーバー + tRPC HTTP サーバーで実行。
 * HTTP フォールバックモードでは subscription は無効化される。
 *
 * テストフロー:
 *   1. 初期画面（規約モーダル or メイン画面）のスクリーンショット
 *   2. 規約未同意の場合は同意処理
 *   3. セットアップ画面が表示されたらパスを入力して完了
 *   4. メイン画面（ギャラリー）到達後のスクリーンショット
 */
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
  await page.waitForTimeout(2000);
  const isTermsButtonVisible = await page.isVisible('text=同意する');
  if (isTermsButtonVisible) {
    console.log('Terms button found, clicking...');
    await screenshot(page, title, 'terms');
    await page.click('text=同意する');
    await page.waitForTimeout(2000);
  } else {
    consola.log('「同意する」ボタンが表示されていません');
  }

  // 規約同意後またはメイン画面到達後の状態を確認
  console.log('Waiting for app to settle...');
  await page.waitForTimeout(3000);
  await screenshot(page, title, 'debug-current-state');

  // セットアップ画面かメイン画面かを判定
  const hasSetupScreen = await page.isVisible('text=初期セットアップ');
  const hasMainContent =
    (await page
      .locator('[data-testid="location-group-header"], .photo-card')
      .count()) > 0;

  if (hasSetupScreen) {
    // セットアップ画面が表示されている場合、パスを入力して遷移する
    console.log('Setup screen detected - filling in paths');
    await screenshot(page, title, 'setup');

    // VRChatログファイルディレクトリの入力
    try {
      const logFileInput = await page.waitForSelector(
        '[aria-label="input-VRChatログファイルディレクトリ"]',
        { timeout: 5000 },
      );
      await logFileInput.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type(path.join(__dirname, '../debug/logs'));
      const logSubmitButton = await page.waitForSelector(
        '[aria-label="送信-VRChatログファイルディレクトリ"]',
      );
      await logSubmitButton.click();
      console.log('Log directory path submitted');

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
      console.log('Photo directory path submitted');

      // 「設定を確認して続ける」ボタンをクリック
      const continueButton = await page.waitForSelector(
        'text=設定を確認して続ける',
      );
      await continueButton.click();
      console.log('Continue button clicked, waiting for main screen...');

      // メイン画面が表示されるまで待機
      await page.waitForTimeout(3000);
    } catch (error) {
      console.log('Setup path filling failed:', error);
      // パス入力に失敗してもテストは継続する
    }
  } else if (hasMainContent) {
    console.log('Main content already loaded');
  } else {
    console.log('Neither setup nor main content detected');
  }

  // メイン画面（ギャラリーまたは空画面）のスクリーンショット
  // LocationGroupHeader または写真カードが表示されるのを待つ
  try {
    console.log('Waiting for main content to load...');
    await page.waitForSelector(
      '[data-testid="location-group-header"], .photo-card',
      { timeout: 15000 },
    );
    await screenshot(page, title, 'logs-loaded');
  } catch {
    // メインコンテンツが見つからなくても現在の状態をキャプチャ
    console.log(
      'Main content not found within timeout, capturing current state',
    );
  }

  // 最終状態のスクリーンショット
  await page.waitForTimeout(500);
  await screenshot(page, title, 'finalized');

  // テスト終了時に必須スクリーンショットの確認
  console.log('\n=== Verifying screenshots ===');

  // 必須: initial と finalized は常に撮影される
  const requiredScreenshots = ['initial', 'debug-current-state', 'finalized'];

  // オプショナル: terms, setup, logs-loaded はフローによって撮影されない場合がある
  const optionalScreenshots = ['terms', 'setup', 'logs-loaded'];

  for (const name of requiredScreenshots) {
    if (!screenshotsTaken.has(name)) {
      throw new Error(`Required screenshot was not taken: ${name}`);
    }

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

  for (const name of optionalScreenshots) {
    if (screenshotsTaken.has(name)) {
      const screenshotFile = screenshotPath(title, name);
      const stats = fs.statSync(screenshotFile);
      console.log(`✅ ${name}: ${(stats.size / 1024).toFixed(1)} KB`);
    } else {
      console.log(`⏭️  ${name}: skipped (not applicable in this flow)`);
    }
  }

  console.log(
    `=== ${screenshotsTaken.size} screenshots successfully taken ===\n`,
  );
});
