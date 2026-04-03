/**
 * Electrobun モジュールのモック（Node.js/tsx 環境用）。
 *
 * 背景: dev-trpc-server.ts が electron/api.ts をインポートすると、
 * 依存チェーンで electrobun/bun がインポートされる。
 * Node.js/tsx 環境では electrobun ランタイムが存在しないため、
 * vitest.setup.ts と同様のモックを require フックで提供する。
 *
 * 使い方: node --require ./scripts/mock-electrobun.cjs ...
 */
const Module = require('node:module');
const path = require('node:path');
const os = require('node:os');

const originalResolveFilename = Module._resolveFilename;

const mockUtils = {
  paths: {
    userData: path.join(os.tmpdir(), 'dev-trpc-user-data'),
    userLogs: path.join(os.tmpdir(), 'dev-trpc-logs'),
    home: os.homedir(),
    appData: path.join(os.tmpdir(), 'dev-trpc-appdata'),
    temp: os.tmpdir(),
    downloads: path.join(os.homedir(), 'Downloads'),
    documents: path.join(os.homedir(), 'Documents'),
    pictures: path.join(os.homedir(), 'Pictures'),
    desktop: path.join(os.homedir(), 'Desktop'),
  },
  openExternal: () => {},
  openPath: () => {},
  showItemInFolder: () => {},
  openFileDialog: async () => [],
  showNotification: () => {},
  clipboardReadText: () => '',
  clipboardWriteText: () => {},
  clipboardWriteImage: () => {},
  quit: () => {},
};

const electrobunBunMock = {
  Utils: mockUtils,
  BrowserWindow: class BrowserWindow {
    constructor() {}
    static getAllWindows() {
      return [];
    }
    static defineRPC() {
      return {};
    }
  },
  BrowserView: {
    defineRPC: () => ({}),
  },
  Tray: class Tray {
    constructor() {}
    setMenu() {}
    remove() {}
  },
  Screen: {
    getPrimaryDisplay: () => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }),
  },
};

const electrobunViewMock = {
  Electroview: class Electroview {
    constructor() {}
    rpc = { request: {}, send: {} };
  },
};

// Intercept electrobun module resolution
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electrobun/bun' || request === 'electrobun/view') {
    // Return a fake path that we'll intercept in require
    return `mock:${request}`;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Inject mock modules into the cache
const electrobunBunKey = 'mock:electrobun/bun';
const electrobunViewKey = 'mock:electrobun/view';

require.cache[electrobunBunKey] = {
  id: electrobunBunKey,
  filename: electrobunBunKey,
  loaded: true,
  exports: electrobunBunMock,
};

require.cache[electrobunViewKey] = {
  id: electrobunViewKey,
  filename: electrobunViewKey,
  loaded: true,
  exports: electrobunViewMock,
};
