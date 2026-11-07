/**
 * 画面（preload）と main プロセスが、tRPC を運ぶ MessagePort を受け渡すときの IPC チャンネルの名前。
 *
 * preload（`./preload.ts`）と main の仲介（`./index.ts`）が同じ名前を使う。preload は sandbox 内で
 * 単一ファイルにバンドルされるため、Electron の API を読み込むモジュールを巻き込まないよう、
 * 定数だけをこのファイルに置く。
 */

/** preload が「この文書用の port をください」と main へ頼むチャンネル（preload → main） */
export const TRPC_PORT_REQUEST_CHANNEL = 'vrchat-albums:trpc-port-request';

/** main が preload へ port を渡すチャンネル（main → preload）。メッセージ本体は持たず、port だけを運ぶ */
export const TRPC_PORT_CHANNEL = 'vrchat-albums:trpc-port';
