import { defineConfig } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './playwright',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: Boolean(process.env.CI),
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  /* テストは同一SQLiteファイルへのアクセスで競合するため、ローカルでも1 worker */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html', { open: 'never' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        trace: process.env.CI ? 'on-first-retry' : 'on',
      },
      /**
       * Electron API を使用するスペック（init-progress, memory-profiling,
       * photo-loading-debug）を除外し、ブラウザベースの screenshot テストのみ実行。
       *
       * 背景: Electrobun 移行後は Electron ランタイムが不要。
       * Electron 専用テストは将来 Electrobun 対応または別プロジェクトに移行予定。
       */
      testMatch: 'screenshot.spec.ts',
      metadata: {
        platform: process.platform,
        headful: true,
        browserName: 'chromium',
        channel: undefined,
        mode: 'default',
        video: false,
      },
    },
  ],

  /**
   * Vite dev サーバーと tRPC HTTP サーバーの両方を起動する。
   *
   * 背景: Electrobun 移行後、Playwright テストは Electron アプリではなく
   * Chromium ブラウザで Vite dev サーバーに直接アクセスする。
   * tRPC 通信は dev-trpc-server (HTTP) 経由で行う。
   */
  webServer: [
    {
      command: 'pnpm dev:trpc-server',
      port: 3001,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'pnpm dev:vite',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NODE_OPTIONS: `--max-old-space-size=${
          process.env.PLAYWRIGHT_MAX_MEMORY ?? '4096'
        }`,
      },
    },
  ],
});
