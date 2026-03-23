import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

// テスト環境で npm_package_version が設定されていない場合のフォールバック
// getAppVersion() が App version is undefined エラーを投げるのを防ぐ
if (!process.env.npm_package_version) {
  process.env.npm_package_version = '0.0.0-test';
}

import * as client from './electron/lib/sequelize';

// Sentryのモック設定
vi.mock('@sentry/electron/main', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

// React Testing Libraryのクリーンアップ
afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await client.__cleanupTestRDBClient();
});

// electronモジュールのモック
vi.mock('electron', () => {
  const mockApp = {
    getPath: vi.fn(),
    getName: vi.fn(),
    getVersion: vi.fn(),
    quit: vi.fn(),
  };

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn(),
  };

  const mockIpcRenderer = {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  };

  const mockDialog = {
    showOpenDialog: vi.fn(),
  };

  const mockBrowserWindow = vi.fn();

  // CommonJSモジュールとしてエクスポート
  const mock = {
    default: {
      app: mockApp,
      ipcMain: mockIpcMain,
      ipcRenderer: mockIpcRenderer,
      BrowserWindow: mockBrowserWindow,
      dialog: mockDialog,
    },
    app: mockApp,
    ipcMain: mockIpcMain,
    ipcRenderer: mockIpcRenderer,
    BrowserWindow: mockBrowserWindow,
    dialog: mockDialog,
  };

  return mock;
});

// vi.mock section after existing mocks
vi.mock('electron-trpc/renderer', () => {
  /** No-op TRPC link mock to prevent tests from requiring Electron context */
  // oxlint-disable-next-line eslint-plugin-unicorn(consistent-function-scoping) -- vi.mockはホイスティングされるため、外部スコープの変数を参照できない
  const mockIpcLink = () => {
    return (_runtime: unknown) =>
      ({ next, op }: { next: (operation: unknown) => unknown; op: unknown }) =>
        next(op);
  };
  return {
    ipcLink: mockIpcLink,
  };
});
