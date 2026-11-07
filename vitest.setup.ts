import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

// テスト環境で npm_package_version が設定されていない場合のフォールバック
// getAppVersion() が App version is undefined エラーを投げるのを防ぐ
process.env.npm_package_version ??= '0.0.0-test';

import { registerHost } from './electron/lib/host';
import { createTestHost } from './electron/lib/host/testHost';
import * as client from './electron/lib/sequelize';

// electron/module のサービスは getHost() から OS の機能を受け取るため、
// 全テストで既定の殻を登録しておく。値や操作を確かめたいテストは各自で登録し直す
registerHost(createTestHost());

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
