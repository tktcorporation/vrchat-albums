/**
 * ビルド時に注入されるグローバル定数の型定義。
 *
 * preload が公開する `window.Main` の型は electron/preload.ts にある。
 * `window.electronTRPC` は trpc-electron の ipcLink が直接読むため、アプリ側では型を持たない。
 */
export type {};

declare global {
  const __SENTRY_RELEASE__: string;
}
