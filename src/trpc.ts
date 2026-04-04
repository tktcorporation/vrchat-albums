/**
 * tRPC クライアント（Electrobun 版）。
 *
 * 背景: Electron では trpc-electron/renderer の ipcLink を使用していた。
 * Electrobun では RPC 経由で tRPC ルーターを呼び出す。
 *
 * Electrobun RPC の trpcCall を使い、既存の tRPC ルーターを呼び出す。
 * trpcReact と trpcClient のインターフェースは Electron 版と同じ。
 */
export { trpcReact, trpcClient } from './trpc-electrobun';
