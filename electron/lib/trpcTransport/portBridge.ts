/**
 * preload が画面へ公開する通信路（`shared/trpcTransport.ts` の `MessageChannel`）を、
 * main から受け取る MessagePort の上に組み立てる。
 *
 * MessagePort は contextBridge を越えられないので、port は preload が持ったまま、
 * 送信と受信の登録だけを関数として画面へ渡す。port は文書が読み込まれた後に main から届くため、
 * 届くまでに画面が送ったメッセージは貯めておき、届いた時点で順に送る。
 * 処理本体の再起動などで port が配り直されたときは、新しい port へ差し替え、画面が登録した受信はそのまま使う。
 *
 * preload のバンドルに Electron 以外を巻き込まないよう、Electron の型は使う部分だけを受け取る。
 * 単体テストが偽物の ipcRenderer と MessagePort で確かめられるようにするためでもある。
 */
import type {
  ClientMessage,
  MessageChannel,
  ServerMessage,
} from '../../../shared/trpcTransport';
import { TRPC_PORT_CHANNEL, TRPC_PORT_REQUEST_CHANNEL } from './ipcChannelName';

/** DOM の MessagePort のうち、通信路が使う部分 */
export interface BridgePort {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: ClientMessage): void;
  start(): void;
  close(): void;
}

/** Electron の `ipcRenderer` のうち、port の受け取りに使う部分 */
export interface PortReceiver {
  send(channel: string): void;
  on(
    channel: string,
    listener: (event: { readonly ports: readonly BridgePort[] }) => void,
  ): unknown;
}

/**
 * port を受け取る準備をしてから main へ port を頼み、画面へ渡す通信路を返す。
 *
 * 頼むのは受け取りの登録の後にする。先に頼むと、登録より前に届いた port を取りこぼす。
 */
export const createPortBridge = (
  ipc: PortReceiver,
): MessageChannel<ClientMessage, ServerMessage> => {
  let port: BridgePort | null = null;
  const pending: ClientMessage[] = [];
  const listeners = new Set<(message: ServerMessage) => void>();

  ipc.on(TRPC_PORT_CHANNEL, (event) => {
    const [nextPort] = event.ports;
    if (nextPort === undefined) {
      return;
    }
    port?.close();
    port = nextPort;
    // 届く値は main が仲介した処理本体の応答で、形は処理本体の serveTrpc が決める
    nextPort.onmessage = ({ data }) => {
      for (const listener of listeners) {
        listener(data as ServerMessage);
      }
    };
    nextPort.start();
    for (const message of pending.splice(0)) {
      nextPort.postMessage(message);
    }
  });
  ipc.send(TRPC_PORT_REQUEST_CHANNEL);

  return {
    send: (message) => {
      if (port === null) {
        pending.push(message);
        return;
      }
      port.postMessage(message);
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
