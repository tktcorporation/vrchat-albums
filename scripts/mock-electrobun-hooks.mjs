/**
 * Electrobun モジュール解決フック。
 *
 * Node.js の customization hooks API を使用して、
 * electrobun/bun と electrobun/view の resolve をインターセプトする。
 */

const MOCK_SPECIFIERS = new Set(['electrobun/bun', 'electrobun/view']);

export async function resolve(specifier, context, nextResolve) {
  if (MOCK_SPECIFIERS.has(specifier)) {
    return {
      shortCircuit: true,
      url: `mock:${specifier}`,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'mock:electrobun/bun') {
    return {
      shortCircuit: true,
      format: 'module',
      source: `
        import os from 'node:os';
        import path from 'node:path';

        export const Utils = {
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
          openExternal() {},
          openPath() {},
          showItemInFolder() {},
          async openFileDialog() { return []; },
          showNotification() {},
          clipboardReadText() { return ''; },
          clipboardWriteText() {},
          clipboardWriteImage() {},
          quit() {},
        };

        export class BrowserWindow {
          constructor() {}
          static getAllWindows() { return []; }
          static defineRPC() { return {}; }
        }

        export const BrowserView = {
          defineRPC: () => ({}),
        };

        export class Tray {
          constructor() {}
          setMenu() {}
          remove() {}
        }

        export const Screen = {
          getPrimaryDisplay: () => ({
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          }),
        };
      `,
    };
  }

  if (url === 'mock:electrobun/view') {
    return {
      shortCircuit: true,
      format: 'module',
      source: `
        export class Electroview {
          constructor() {}
          rpc = { request: {}, send: {} };
        }
      `,
    };
  }

  return nextLoad(url, context);
}
