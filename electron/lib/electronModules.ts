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
