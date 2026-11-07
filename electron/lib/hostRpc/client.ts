/**
 * 処理本体（utilityProcess）が使う殻の操作を、main プロセスへの要求として実装する（取り決めは `./protocol.ts`）。
 */
import type { MessageChannel } from '../../../shared/trpcTransport';
import type { HostShell, HostUpdater } from '../host/types';
import {
  type HostRequest,
  HostResponseSchema,
  type HostRpcArgs,
  type HostRpcMethod,
  type HostRpcResult,
} from './protocol';

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

export interface HostRpcClient {
  readonly shell: HostShell;
  readonly updater: HostUpdater;
  /** 応答待ちの要求をすべて失敗にし、以後の応答を受け取らない */
  dispose(): void;
}

/**
 * main へ殻の操作を頼む `HostShell` と `HostUpdater` を作る。
 *
 * 応答の値は main が実際の実装の戻り値をそのまま返したもので、main は信頼できる相手なので、
 * 値の形は確かめずに操作の戻り値の型として扱う。応答の枠（ID と成否）だけを確かめる。
 * 同じ通信路には応答以外（起動・終了の指示）も流れるので、応答の形でない値は無視する。
 */
export const createHostRpcClient = (
  channel: MessageChannel<HostRequest, unknown>,
): HostRpcClient => {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;

  const stopListening = channel.onMessage((raw) => {
    const response = HostResponseSchema.safeParse(raw);
    if (!response.success) {
      return;
    }
    const waiting = pending.get(response.data.id);
    if (waiting === undefined) {
      return;
    }
    pending.delete(response.data.id);
    if (response.data.ok) {
      waiting.resolve(response.data.value);
    } else {
      waiting.reject(new Error(response.data.message));
    }
  });

  const call = <M extends HostRpcMethod>(
    method: M,
    ...args: HostRpcArgs<M>
  ): Promise<HostRpcResult<M>> => {
    if (disposed) {
      return Promise.reject(new Error('Host RPC client is disposed'));
    }
    const id = nextId;
    nextId += 1;
    return new Promise<HostRpcResult<M>>((resolve, reject) => {
      pending.set(id, {
        // main は method の実装の戻り値をそのまま返す
        resolve: (value) => resolve(value as HostRpcResult<M>),
        reject,
      });
      // method と args の対応は call の型引数が保証する
      channel.send({ kind: 'hostRequest', id, method, args } as HostRequest);
    });
  };

  const shell: HostShell = {
    openPath: (targetPath) => call('shell.openPath', targetPath),
    openExternal: (url) => call('shell.openExternal', url),
    showOpenDialog: (properties) => call('shell.showOpenDialog', properties),
    showSaveDialog: (options) => call('shell.showSaveDialog', options),
    writeClipboardImageFromPngFile: (pngPath) =>
      call('shell.writeClipboardImageFromPngFile', pngPath),
    writeClipboardText: (text) => call('shell.writeClipboardText', text),
    notify: (notification) => call('shell.notify', notification),
    getOpenAtLogin: () => call('shell.getOpenAtLogin'),
    setOpenAtLogin: (openAtLogin) => call('shell.setOpenAtLogin', openAtLogin),
    reloadWindow: () => call('shell.reloadWindow'),
    onTermsAccepted: () => call('shell.onTermsAccepted'),
  };

  const updater: HostUpdater = {
    checkForUpdates: () => call('updater.checkForUpdates'),
    quitAndInstall: () => call('updater.quitAndInstall'),
    getStatus: () => call('updater.getStatus'),
  };

  return {
    shell,
    updater,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      stopListening();
      const error = new Error('Host RPC connection closed');
      for (const waiting of pending.values()) {
        waiting.reject(error);
      }
      pending.clear();
    },
  };
};
