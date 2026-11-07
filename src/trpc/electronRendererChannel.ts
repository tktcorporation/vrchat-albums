/**
 * 画面側の tRPC 通信路を、preload が公開する `window.electronTRPC`（`electron/lib/trpcTransport/preload.ts` の `exposeTrpcBridge`）で作る。
 *
 * `window.electronTRPC` は呼び出しのたびに読む。preload の無い環境（テストやブラウザでの実行）で
 * このモジュールを読み込んだだけでは失敗させず、実際に通信しようとした時点で失敗させるため。
 */
import type {
  ClientMessage,
  MessageChannel,
  ServerMessage,
} from '../../shared/trpcTransport';

const getBridge = (): MessageChannel<ClientMessage, ServerMessage> => {
  const bridge = window.electronTRPC;
  if (!bridge) {
    throw new Error(
      'window.electronTRPC が見つかりません。preload（electron/preload.ts）が読み込まれていません。',
    );
  }
  return bridge;
};

export const electronRendererChannel: MessageChannel<
  ClientMessage,
  ServerMessage
> = {
  send: (message) => getBridge().send(message),
  onMessage: (listener) => getBridge().onMessage(listener),
};
