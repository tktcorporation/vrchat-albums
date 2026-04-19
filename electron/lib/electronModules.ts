/**
 * Electron モジュールの遅延取得ヘルパー。
 *
 * トップレベルで `import { app } from 'electron'` すると、
 * Playwright テスト実行時に Electron の初期化がブロックされてタイムアウトする。
 * このモジュールで遅延 require に集約し、各 service/controller から利用する。
 *
 * 参照: .claude/rules/electron-import.md
 *
 * 注意: テスト環境ではフォールバックが必要な場合は wrappedApp.ts の
 * try-catch パターンを使うこと。このモジュールはフォールバックなしの
 * 「Electron 環境前提」のヘルパー。
 */

import type Electron from 'electron';
const getElectron = () => require('electron') as typeof Electron;

export const getApp = () => getElectron().app;
export const getShell = () => getElectron().shell;
export const getDialog = () => getElectron().dialog;
export const getClipboard = () => getElectron().clipboard;
export const getNativeImage = () => getElectron().nativeImage;

/**
 * Electron 環境であれば `fn(app)` を、そうでなければ `fallback` を返す。
 *
 * 背景: 「Electron 前提だがテスト環境でも動く必要がある」モジュール（logger,
 * wrappedApp, exportService, vrchatPhoto.service, renderSvg）で
 * 同じ try-catch + `require('electron')` の遅延ロードパターンが重複していた。
 * このヘルパーで集約することで:
 *   - `effect-lint-allow-try-catch` 注釈付き try-catch を削減
 *   - フォールバック値の組み立て方を呼び出し側に委ねる（高階関数）
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
