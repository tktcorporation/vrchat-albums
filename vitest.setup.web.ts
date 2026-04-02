import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// @sentry/browser のモック設定
vi.mock('@sentry/browser', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  init: vi.fn(),
}));

// React Testing Library のクリーンアップ
afterEach(() => {
  cleanup();
});

// Electrobun モジュールのモック
vi.mock('electrobun/bun', () => ({
  Utils: {
    paths: {
      userData: '/tmp/test-user-data',
      userLogs: '/tmp/test-logs',
      home: '/tmp/test-home',
    },
  },
  BrowserWindow: vi.fn(),
  BrowserView: { defineRPC: vi.fn() },
}));

vi.mock('electrobun/view', () => ({
  Electroview: vi.fn().mockReturnValue({ rpc: { request: {}, send: {} } }),
}));

// Electron モジュールのモック（後方互換性）
vi.mock('electron', () => {
  const mockApp = {
    getPath: vi.fn(),
    getName: vi.fn(),
    getVersion: vi.fn(),
    quit: vi.fn(),
  };

  const mockIpcMain = { handle: vi.fn(), on: vi.fn() };
  const mockIpcRenderer = { invoke: vi.fn(), on: vi.fn(), send: vi.fn() };
  const mockDialog = { showOpenDialog: vi.fn() };
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
