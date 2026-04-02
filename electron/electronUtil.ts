/**
 * ウィンドウ・トレイ管理ユーティリティ（Electrobun 互換版）。
 *
 * 背景: Electron 版では BrowserWindow, Tray, Menu, screen 等を使用していた。
 * Electrobun 移行後はこれらの機能が src/bun/ に移動したため、
 * このファイルは tRPC ルーターや他モジュールからの参照のために
 * 最小限のスタブを提供する。
 *
 * Electrobun の代替:
 *   - ウィンドウ管理: src/bun/index.ts
 *   - トレイ: src/bun/tray.ts
 *   - メニュー: src/bun/menu.ts
 */
import { logger } from './lib/logger';
import { getSettingStore, type SettingStore } from './module/settingStore';

let settingStore: SettingStore | null = null;

/**
 * 他モジュールから設定ストアを利用できるよう初期化する。
 * main プロセス起動時に一度だけ呼び出されることを想定。
 */
export const initializeSettingStoreForUtil = (): void => {
  if (settingStore === null) {
    settingStore = getSettingStore();
    logger.info('SettingStore initialized for electronUtil.ts');
  }
};

/**
 * ウィンドウ生成スタブ。
 * Electrobun では src/bun/index.ts で BrowserWindow を作成する。
 * tRPC ルーターからの参照互換性のために残す。
 */
export const createOrGetWindow = (): unknown => {
  logger.debug('createOrGetWindow called (Electrobun stub)');
  return {};
};

/**
 * トレイ設定スタブ。
 * Electrobun では src/bun/tray.ts で Tray を設定する。
 */
export const setTray = (): Promise<void> => {
  logger.debug('setTray called (Electrobun stub)');
  return Promise.resolve();
};

/**
 * タイマーイベント設定スタブ。
 * バックグラウンド同期処理は将来 Electrobun 用に再実装予定。
 */
export const setTimeEventEmitter = (
  _passedSettingStore: ReturnType<typeof getSettingStore>,
): void => {
  logger.debug('setTimeEventEmitter called (Electrobun stub)');
};

/**
 * メインウィンドウリロードスタブ。
 */
export const reloadMainWindow = (): void => {
  logger.debug('reloadMainWindow called (Electrobun stub)');
};
