/**
 * アプリケーションメニューの設定。
 *
 * 背景: Electron では Menu.buildFromTemplate を使用していた。
 * Electrobun では ApplicationMenu.setApplicationMenu を使用。
 *
 * 注意: Linux ではアプリケーションメニューは現在未サポート。
 *
 * 呼び出し元: src/bun/index.ts
 */
import { ApplicationMenu } from 'electrobun/bun';

/**
 * アプリケーションメニューを設定する。
 * 標準的な Edit メニュー（Undo/Redo/Copy/Paste 等）とアプリ終了を含む。
 */
export const setupApplicationMenu = (): void => {
  ApplicationMenu.setApplicationMenu([
    {
      submenu: [
        { label: 'VRChat Albums について', role: 'about' },
        { type: 'separator' },
        { label: '終了', role: 'quit' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'ウィンドウ',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'toggleFullScreen' },
      ],
    },
  ]);
};
