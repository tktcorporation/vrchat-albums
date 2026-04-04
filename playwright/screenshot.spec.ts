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

/**
 * 初期ユーザーの一連の操作フローを E2E で検証し、各画面のスクリーンショットを撮影する。
 *
 * ## なぜこのテストが存在するか
 *
 * このテストの役割は、初めてアプリを起動したユーザーが踏む一連のフローが
 * 壊れていないことをシナリオベースで検証すること。
 * 個々のコンポーネントの単体テストでは検出できない、画面遷移やデータフローの
 * 結合不具合を捕捉するために存在する。
 *
 * ## テストフロー（全ステップ必須）
 *
 *   1. initial    - アプリ起動直後
 *   2. terms      - 規約同意画面 → 「同意する」をクリック
 *   3. setup      - 初期セットアップ画面 → VRChat ログ/写真ディレクトリを設定
 *   4. gallery    - ギャラリー画面到達（写真・ワールド情報が表示される）
 *   5. finalized  - 最終状態
 *
 * 各ステップは省略不可。いずれかが失敗した場合、テスト全体が失敗する。
 * これにより、初期ユーザーフローの一部が壊れた場合に即座に検出できる。
 *
 * ## 前提
 *
 *   - playwright.config.ts の webServer で Vite dev サーバー + tRPC HTTP サーバーが起動
 *   - pnpm generate:debug-data で debug/logs/ と debug/photos/VRChat/ にテストデータ生成済み
 */

// 初期化 → ログ同期 → 写真読み込みまで含むため、余裕を持ったタイムアウト
test.setTimeout(120_000);

test('初期ユーザーフロー: 規約同意 → セットアップ → ギャラリー表示', async ({
  page,
}) => {
  screenshotsTaken = new Set();

  // ── 前準備 ──
  // 外部フォント（Google Fonts）のリクエストをブロック。
  // テスト環境ではネットワーク到達不能の場合があり、
  // page.screenshot() が「waiting for fonts to load」で無期限にブロックされる問題を防ぐ。
  await page.route('**/*.googleapis.com/**', (route) => route.abort());
  await page.route('**/*.gstatic.com/**', (route) => route.abort());

  // ブラウザ console をテスト出力に転送（デバッグ用）
  page.on('pageerror', (error) => {
    console.error('[Page Error]', error.message);
  });
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[Browser ${type}] ${msg.text()}`);
    }
  });

  console.log('Navigating to Vite dev server...');
  await page.goto('http://localhost:3000');
  const title = (await page.title()) || 'VRChatAlbums';

  await screenshot(page, title, 'initial');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 1: 規約同意
  // 初回起動時は必ず規約モーダルが表示される。
  // tRPC getTermsAccepted クエリが完了すると表示されるため、十分な待機が必要。
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('[Step 1] Waiting for terms modal...');
  await page.waitForSelector('text=同意する', { timeout: 20_000 });
  await screenshot(page, title, 'terms');
  await page.click('text=同意する');
  console.log('[Step 1] Terms accepted');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 2: 初期セットアップ
  // VRChat ディレクトリが未設定の初回起動では、initializeAppData が
  // SETUP_REQUIRED エラーを返し、セットアップ画面が表示される。
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('[Step 2] Waiting for setup screen...');
  await page.waitForSelector('text=初期セットアップ', { timeout: 20_000 });
  await screenshot(page, title, 'setup');
  console.log('[Step 2] Setup screen displayed');

  // VRChat ログファイルディレクトリのパスを設定
  const logPath = path.resolve(__dirname, '../debug/logs');
  const photoPath = path.resolve(__dirname, '../debug/photos/VRChat');

  // ログディレクトリ: 入力 → 送信ボタン表示を待って → クリック
  await page.fill(
    '[aria-label="input-VRChatログファイルディレクトリ"]',
    logPath,
  );
  console.log(`[Step 2] Log path filled: ${logPath}`);

  // fill() で値が変わると isManuallyChanged=true → 送信ボタンが出現する
  await page.waitForSelector(
    '[aria-label="送信-VRChatログファイルディレクトリ"]',
    { timeout: 5_000 },
  );
  await page.click('[aria-label="送信-VRChatログファイルディレクトリ"]');
  console.log('[Step 2] Log path submitted');

  // tRPC mutation の完了を待つ
  await page.waitForTimeout(1_500);

  // 写真ディレクトリ: 入力 → 送信ボタン表示を待って → クリック
  await page.fill('[aria-label="input-写真ディレクトリ"]', photoPath);
  console.log(`[Step 2] Photo path filled: ${photoPath}`);

  await page.waitForSelector('[aria-label="送信-写真ディレクトリ"]', {
    timeout: 5_000,
  });
  await page.click('[aria-label="送信-写真ディレクトリ"]');
  console.log('[Step 2] Photo path submitted');

  // tRPC mutation の完了を待つ
  await page.waitForTimeout(1_500);

  // 「設定を確認して続ける」→ メイン画面へ
  await page.click('text=設定を確認して続ける');
  console.log('[Step 2] Setup complete, transitioning to gallery...');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 3: ギャラリー画面
  // セットアップ完了後、initializeAppData が再実行され、
  // ログ同期 → 写真インデックス → ギャラリー表示の順で処理される。
  // LocationGroupHeader または写真カードが表示されれば成功。
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('[Step 3] Waiting for gallery content...');
  await page.waitForSelector(
    '[data-testid="location-group-header"], .photo-card',
    { timeout: 60_000 },
  );
  console.log('[Step 3] Gallery content loaded');
  await screenshot(page, title, 'gallery');

  // 最終状態
  await page.waitForTimeout(500);
  await screenshot(page, title, 'finalized');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // スクリーンショット検証
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n=== Screenshot verification ===');

  const expectedScreenshots = [
    'initial',
    'terms',
    'setup',
    'gallery',
    'finalized',
  ];

  for (const name of expectedScreenshots) {
    expect(
      screenshotsTaken.has(name),
      `Screenshot '${name}' was not taken — the corresponding step in the initial user flow failed`,
    ).toBe(true);

    const file = screenshotPath(title, name);
    expect(fs.existsSync(file), `Screenshot file missing: ${name}`).toBe(true);
    const stats = fs.statSync(file);
    expect(stats.size).toBeGreaterThan(0);
    console.log(`  ✅ ${name}: ${(stats.size / 1024).toFixed(1)} KB`);
  }

  console.log(
    `=== All ${expectedScreenshots.length} screenshots verified ===\n`,
  );
});
