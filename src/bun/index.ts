/**
 * Electrobun メインプロセスのエントリポイント。
 *
 * 背景: Electron の electron/index.ts に相当する。
 * Bun ランタイム上で動作し、BrowserWindow の作成、RPC ハンドラの登録、
 * トレイアイコンの設定、データベースの初期化を行う。
 *
 * 対になるファイル: electron/index.ts (移行元)
 */
import { BrowserView, BrowserWindow } from 'electrobun/bun';

import { setTimeEventEmitter } from '../../electron/electronUtil';
import { getSettingStore } from '../../electron/module/settingStore';
import type { AppRPCSchema } from '../../shared/rpc/types';
import { initializeApp } from './appInit';
import { setupApplicationMenu } from './menu';
import { setupTray } from './tray';
import { createTRPCBridge } from './trpcBridge';

/**
 * Electrobun RPC ハンドラ定義。
 * tRPC ルーターへの呼び出しをブリッジする。
 */
const mainRPC = BrowserView.defineRPC<AppRPCSchema>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      trpcCall: async (params) => {
        const bridge = createTRPCBridge();
        return bridge.call(params);
      },
    },
    messages: {
      '*': (messageName, payload) => {
        console.log(`[RPC] Received message: ${messageName}`, payload);
      },
      windowAction: ({ action }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = (BrowserWindow as any).getAllWindows()[0];
        if (!win) {
          return;
        }

        switch (action) {
          case 'minimize':
            if (win.isMinimized()) {
              win.unminimize();
            } else {
              win.minimize();
            }
            break;
          case 'maximize':
            if (win.isMaximized()) {
              win.unmaximize();
            } else {
              win.maximize();
            }
            break;
          case 'close':
            win.close();
            break;
        }
      },
      errorMessage: ({ message }) => {
        console.error(`[Renderer Error] ${message}`);
      },
    },
  },
});

/**
 * メインウィンドウの作成と初期化。
 */
const createMainWindow = () => {
  const win = new BrowserWindow({
    title: 'VRChat Albums',
    frame: {
      x: 0,
      y: 0,
      width: 1024,
      height: 768,
    },
    titleBarStyle: 'hidden',
    url: 'views://main-ui/index.html',
    rpc: mainRPC,
  });

  return win;
};

/**
 * アプリケーション起動処理。
 */
const main = async () => {
  // データベースとサービスの初期化
  await initializeApp();

  // アプリケーションメニューの設定
  setupApplicationMenu();

  // メインウィンドウの作成
  const win = createMainWindow();

  // トレイアイコンの設定
  setupTray(win);

  // バックグラウンドログ同期タイマーの設定（6時間ごと）
  setTimeEventEmitter(getSettingStore());

  console.log('[VRChatAlbums] Application started successfully');
};

main().catch((error) => {
  console.error('[VRChatAlbums] Failed to start application:', error);
  process.exit(1);
});
