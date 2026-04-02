import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

// テスト環境で npm_package_version が設定されていない場合のフォールバック
// getAppVersion() が App version is undefined エラーを投げるのを防ぐ
process.env.npm_package_version ??= '0.0.0-test';

import * as client from './electron/lib/sequelize';

// Sentry のモック設定（Electrobun 移行後は @sentry/node に移行予定）
vi.mock<typeof import('@sentry/electron/main')>(
  '@sentry/electron/main',
  () => ({
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    init: vi.fn(),
  }),
);

// React Testing Library のクリーンアップ
afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await client.__cleanupTestRDBClient();
});

// Electrobun モジュールのモック
vi.mock<typeof import('electrobun/bun')>('electrobun/bun', () => {
  const mockUtils = {
    paths: {
      userData: '/tmp/test-user-data',
      userLogs: '/tmp/test-logs',
      home: '/tmp/test-home',
      appData: '/tmp/test-appdata',
      temp: '/tmp',
      downloads: '/tmp/test-downloads',
      documents: '/tmp/test-documents',
      pictures: '/tmp/test-pictures',
      desktop: '/tmp/test-desktop',
      config: '/tmp/test-config',
      cache: '/tmp/test-cache',
      logs: '/tmp/test-logs',
      userCache: '/tmp/test-cache',
    },
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
    openFileDialog: vi.fn().mockResolvedValue([]),
    showNotification: vi.fn(),
    clipboardReadText: vi.fn().mockResolvedValue(''),
    clipboardWriteText: vi.fn(),
    quit: vi.fn(),
  };

  const mockBrowserWindow = vi.fn().mockReturnValue({
    close: vi.fn(),
    focus: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    isMinimized: vi.fn().mockReturnValue(false),
    isMaximized: vi.fn().mockReturnValue(false),
    unminimize: vi.fn(),
    unmaximize: vi.fn(),
  });
  mockBrowserWindow.getAllWindows = vi.fn().mockReturnValue([]);

  const mockBrowserView = {
    defineRPC: vi.fn().mockReturnValue({}),
  };

  return {
    Utils: mockUtils,
    BrowserWindow: mockBrowserWindow,
    BrowserView: mockBrowserView,
    ApplicationMenu: { setApplicationMenu: vi.fn() },
    Tray: vi.fn().mockReturnValue({
      setMenu: vi.fn(),
      on: vi.fn(),
      remove: vi.fn(),
    }),
    Screen: {
      getPrimaryDisplay: vi.fn().mockReturnValue({
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      }),
    },
  };
});

vi.mock<typeof import('electrobun/view')>('electrobun/view', () => ({
  Electroview: vi.fn().mockReturnValue({
    rpc: {
      request: {},
      send: {},
    },
  }),
}));

// Electron モジュールのモック（後方互換性のため維持）
vi.mock<typeof import('electron')>('electron', () => {
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
