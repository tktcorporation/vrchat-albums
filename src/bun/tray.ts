/**
 * システムトレイの設定。
 *
 * 背景: electron/electronUtil.ts の setTray() に相当する。
 * Electrobun の Tray API を使用。
 *
 * 呼び出し元: src/bun/index.ts
 */
import type { BrowserWindow } from 'electrobun/bun';
import { Tray, Utils } from 'electrobun/bun';

/**
 * システムトレイアイコンとコンテキストメニューを設定する。
 */
export const setupTray = (mainWindow: BrowserWindow): void => {
  const tray = new Tray({
    title: 'VRChat Albums',
    image: 'views://assets/icon.png',
    template: true,
  });

  tray.setMenu([
    {
      type: 'normal',
      label: 'ウィンドウを表示',
      action: 'show-window',
    },
    { type: 'divider' },
    {
      type: 'normal',
      label: 'ログを開く',
      action: 'open-logs',
    },
    { type: 'divider' },
    {
      type: 'normal',
      label: '終了',
      action: 'quit',
    },
  ]);

  tray.on('tray-clicked', (action) => {
    switch (action) {
      case 'show-window':
        mainWindow.focus();
        break;
      case 'open-logs': {
        const logPath = Utils.paths.userLogs;
        Utils.openPath(logPath);
        break;
      }
      case 'quit':
        Utils.quit();
        break;
    }
  });
};
