/**
 * Electron モジュールの遅延取得ヘルパー。
 *
 * トップレベルで `import { app } from 'electron'` すると、
 * Playwright テスト実行時に Electron の初期化がブロックされてタイムアウトする。
 * このモジュールで遅延 require に集約する。
 *
 * 使うのは殻の側（`electron/lib/host/electronHost.ts` と、殻より先に読み込まれる
 * `electron/lib/logger.ts`）だけ。electron/module のサービスは OS の機能を
 * `getHost()`（electron/lib/host）から受け取り、このモジュールを直接使わない。
 * サービスを utilityProcess へ移すと Electron の API が使えなくなるため。
 *
 * 参照: .claude/rules/project/electron-import.md
 */

import type Electron from 'electron';
const getElectron = () => require('electron') as typeof Electron;

export const getApp = () => getElectron().app;
export const getShell = () => getElectron().shell;
export const getDialog = () => getElectron().dialog;
export const getClipboard = () => getElectron().clipboard;
export const getClipboardItem = () => getElectron().ClipboardItem;
export const getNativeImage = () => getElectron().nativeImage;
export const getNotification = () => getElectron().Notification;
export const getIpcMain = () => getElectron().ipcMain;

/**
 * Electron 環境であれば `fn(app)` を、そうでなければ `fallback` を返す。
 *
 * 殻の登録より先に読み込まれ、テスト環境でも動く必要があるモジュール（logger）が、
 * Electron の有無で値を切り替えるために使う。try-catch による環境検出をここに集約し、
 * フォールバック値の組み立て方は呼び出し側に委ねる。
 *
 * @param fallback テスト/非 Electron 環境で返す値
 * @param fn Electron 環境で `app` を受けて結果を計算する関数
 *
 * @example
 * ```typescript
 * const logPath = withElectronApp(
 *   '/tmp/test-logs/app.log',
 *   (app) => path.join(app.getPath('logs'), 'app.log'),
 * );
 * ```
 */
export const withElectronApp = <T>(
  fallback: T,
  fn: (app: Electron.App) => T,
): T => {
  // effect-lint-allow-try-catch: Electron 環境検出パターン
  try {
    return fn(getElectron().app);
  } catch {
    return fallback;
  }
};
