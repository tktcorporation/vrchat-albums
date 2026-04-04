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
 * dev-trpc-server がデバッグデータのパスを事前設定するため、
 * セットアップ画面をスキップしてギャラリー画面に到達する。
 *
 * テストフロー:
 *   1. 初期画面（規約モーダル）のスクリーンショット
 *   2. 規約同意
 *   3. メイン画面（ギャラリー）到達後のスクリーンショット
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

  // 規約同意後の状態を確認
  console.log('Waiting for app to settle after terms...');
  await page.waitForTimeout(3000);
  await screenshot(page, title, 'debug-current-state');

  // メイン画面（ギャラリー）のコンテンツが表示されるのを待つ
  // dev-trpc-server がデバッグデータのパスを事前設定しているため、
  // セットアップ画面をスキップしてギャラリーに到達するはず
  try {
    console.log('Waiting for main content (gallery) to load...');
    await page.waitForSelector(
      '[data-testid="location-group-header"], .photo-card',
      { timeout: 30000 },
    );
    console.log('Gallery content loaded');
    await screenshot(page, title, 'logs-loaded');
  } catch {
    // ギャラリーが見つからない場合、セットアップ画面かもしれない
    const hasSetupScreen = await page.isVisible('text=初期セットアップ');
    if (hasSetupScreen) {
      console.log(
        'Setup screen still visible - dev-trpc-server may not have pre-configured paths',
      );
      await screenshot(page, title, 'setup');
    } else {
      console.log(
        'Neither gallery nor setup screen found, capturing current state',
      );
    }
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
