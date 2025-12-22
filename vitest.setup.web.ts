import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Sentryのモック設定
vi.mock('@sentry/electron/main', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

// React Testing Libraryのクリーンアップ
afterEach(() => {
  cleanup();
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
  // Mock implementation of ipcLink that returns a no-op TRPC link.
  // This prevents tests from requiring an Electron context with the
  // `electronTRPC` global being exposed.
  const mockIpcLink = () => {
    // Return a TRPC link that simply forwards operations without modification.
    return (_runtime: unknown) =>
      ({ next, op }: { next: (operation: unknown) => unknown; op: unknown }) =>
        next(op);
  };

  return {
    ipcLink: mockIpcLink,
  };
});
