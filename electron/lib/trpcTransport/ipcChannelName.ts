/**
 * tRPC のメッセージ（`shared/trpcTransport.ts`）を運ぶ IPC チャンネルの名前。
 *
 * preload（`electron/preload.ts`）と処理本体側の受け口（`./electronIpcChannel.ts`）が
 * 同じ名前を使う。preload は sandbox 内で単一ファイルにバンドルされるため、
 * Electron の API を読み込むモジュールを巻き込まないよう、定数だけをこのファイルに置く。
 */
export const TRPC_IPC_CHANNEL = 'vrchat-albums:trpc';
