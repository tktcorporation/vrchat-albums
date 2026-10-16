/**
 * ビルド時に注入されるグローバル定数の型定義。
 *
 * preload が公開する `window.Main` / `window.electronTRPC` の型は electron/preload.ts にある。
 */
export type {};

declare global {
  const __SENTRY_RELEASE__: string;
}
