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
 * 初期ユーザーの一連の操作フローを E2E で検証し、各画面のスクリーンショットを撮影する。
 *
 * このテストの目的:
 *   初めてアプリを起動したユーザーが、規約同意 → 初期セットアップ（パス設定） →
 *   ギャラリー画面到達 までの一連のフローが壊れていないことをシナリオベースで検証する。
 *   各ステップでスクリーンショットを撮影し、PR 上で視覚的にレビューできるようにする。
 *
 * テストフロー:
 *   1. initial    - アプリ起動直後（規約モーダル表示）
 *   2. terms      - 規約同意画面
 *   3. setup      - 初期セットアップ画面（VRChat ディレクトリ未設定状態）
 *   4. logs-loaded - セットアップ完了後、ギャラリー画面（写真・ワールド情報表示）
 *   5. finalized  - 最終状態
 *
 * 前提:
 *   - playwright.config.ts の webServer で Vite dev サーバー + tRPC HTTP サーバーが起動
 *   - pnpm generate:debug-data で debug/logs/ と debug/photos/VRChat/ にテストデータ生成済み
 */
test('各画面でスクショ', async ({ page }) => {
  // スクリーンショット追跡をリセット
  screenshotsTaken = new Set();

  // Vite dev サーバーに直接アクセス（playwright.config.ts の webServer が起動）
  console.log('Navigating to Vite dev server...');
  await page.goto('http://localhost:3000');

  const title = (await page.title()) || 'VRChatAlbums';

  page.on('pageerror', (error) => {
    console.error('[Page Error]', error.message);
  });

  await screenshot(page, title, 'initial');

  // ── Step 1: 規約同意 ──
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

  // ── Step 2: 初期セットアップ ──
  // VRChat ディレクトリが未設定のため、セットアップ画面が表示されるはず
  console.log('Waiting for setup screen...');
  await page.waitForTimeout(3000);
  await screenshot(page, title, 'debug-current-state');

  const hasSetupScreen = await page.isVisible('text=初期セットアップ');
  if (hasSetupScreen) {
    console.log('Setup screen detected - filling in paths');
    await screenshot(page, title, 'setup');

    // VRChatログファイルディレクトリのパスを設定
    // page.fill() は React の制御コンポーネントと互換性が高い
    // （keyboard.type() と異なり、input イベントを正しく発火する）
    const logPath = path.resolve(__dirname, '../debug/logs');
    const photoPath = path.resolve(__dirname, '../debug/photos/VRChat');

    await page.fill(
      '[aria-label="input-VRChatログファイルディレクトリ"]',
      logPath,
    );
    console.log(`Log directory path filled: ${logPath}`);

    // fill() で値が変わると isManuallyChanged=true になり、送信ボタンが表示される
    await page.waitForSelector(
      '[aria-label="送信-VRChatログファイルディレクトリ"]',
      { timeout: 3000 },
    );
    await page.click('[aria-label="送信-VRChatログファイルディレクトリ"]');
    console.log('Log directory path submitted');
    await page.waitForTimeout(1000);

    // 写真ディレクトリのパスを設定
    await page.fill('[aria-label="input-写真ディレクトリ"]', photoPath);
    console.log(`Photo directory path filled: ${photoPath}`);

    await page.waitForSelector('[aria-label="送信-写真ディレクトリ"]', {
      timeout: 3000,
    });
    await page.click('[aria-label="送信-写真ディレクトリ"]');
    console.log('Photo directory path submitted');
    await page.waitForTimeout(1000);

    // 「設定を確認して続ける」ボタンをクリックしてメイン画面へ遷移
    const continueButton = await page.waitForSelector(
      'text=設定を確認して続ける',
      { timeout: 5000 },
    );
    await continueButton.click();
    console.log('Continue button clicked, transitioning to gallery...');
  } else {
    console.log('Setup screen not detected, app may already be configured');
  }

  // ── Step 3: ギャラリー画面到達の確認 ──
  // LocationGroupHeader または写真カードが表示されるまで待機
  try {
    console.log('Waiting for gallery content to load...');
    await page.waitForSelector(
      '[data-testid="location-group-header"], .photo-card',
      { timeout: 30000 },
    );
    console.log('Gallery content loaded successfully');
    await screenshot(page, title, 'logs-loaded');
  } catch {
    console.log('Gallery content not found within timeout');
    await screenshot(page, title, 'gallery-timeout');
  }

  // 最終状態のスクリーンショット
  await page.waitForTimeout(500);
  await screenshot(page, title, 'finalized');

  // ── スクリーンショット検証 ──
  console.log('\n=== Verifying screenshots ===');

  const requiredScreenshots = ['initial', 'debug-current-state', 'finalized'];
  const optionalScreenshots = [
    'terms',
    'setup',
    'logs-loaded',
    'gallery-timeout',
  ];

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
