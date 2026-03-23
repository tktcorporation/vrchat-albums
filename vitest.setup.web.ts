import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Sentryのモック設定
vi.mock<typeof import('@sentry/electron/main')>(
  '@sentry/electron/main',
  () => ({
    captureException: vi.fn(),
    init: vi.fn(),
  }),
);

// React Testing Libraryのクリーンアップ
afterEach(() => {
  cleanup();
});

// electronモジュールのモック
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
vi.mock<typeof import('electron-trpc/renderer')>(
  'electron-trpc/renderer',
  () => {
    /** No-op TRPC link mock to prevent tests from requiring Electron context */
    // oxlint-disable-next-line eslint-plugin-unicorn(consistent-function-scoping) -- vi.mockはホイスティングされるため、外部スコープの変数を参照できない
    const mockIpcLink = () => {
      return (_runtime: unknown) =>
        ({
          next,
          op,
        }: {
          next: (operation: unknown) => unknown;
          op: unknown;
        }) =>
          next(op);
    };
    return {
      ipcLink: mockIpcLink,
    };
  },
);
