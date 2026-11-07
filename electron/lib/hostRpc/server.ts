/**
 * 処理本体からの殻の操作の要求を、main プロセスで実行して応える（取り決めは `./protocol.ts`）。
 */
import * as path from 'node:path';

import { Effect } from 'effect';
import { match } from 'ts-pattern';

import type { MessageChannel } from '../../../shared/trpcTransport';
import { checkExternalUrl } from '../externalUrl';
import type { HostShell, HostUpdater } from '../host/types';
import { logger } from '../logger';
import {
  HOST_RPC_ARGS,
  type HostResponse,
  type HostRpcArgs,
  type HostRpcMethod,
  type HostRpcMethods,
  HostRequestSchema,
} from './protocol';

/**
 * OS のハンドラへ渡す操作を、main の側でもう一度確かめる。
 *
 * 処理本体は画面から届いた文字列をそのまま渡しうる。`shell.openExternal` は URL のスキームに
 * 関連付けられたハンドラを起動するので、`file:` などを通すとローカルの実行ファイルを開けてしまう。
 * 処理本体の側の確認が漏れても、OS を操作する main で止める。
 */
const openExternalChecked = (shell: HostShell, url: string): Promise<void> => {
  const checked = checkExternalUrl(url);
  if (!checked.ok) {
    return Promise.reject(
      new Error(
        `Refused to open external URL (${checked.rejection.type}): ${url}`,
      ),
    );
  }
  return shell.openExternal(checked.url);
};

/**
 * `shell.openPath` は相対パスを OS の作業ディレクトリから解決し、意図しない場所を開きうるので、
 * 絶対パスだけを受け付ける。開く対象（フォルダ・写真・ログ）はどれも処理本体が絶対パスで持つ。
 */
const openPathChecked = (
  shell: HostShell,
  targetPath: string,
): Promise<string> => {
  if (!path.isAbsolute(targetPath)) {
    return Promise.reject(
      new Error(`Refused to open a relative path: ${targetPath}`),
    );
  }
  return shell.openPath(targetPath);
};

/** 要求を実際の実装へ渡す表。操作を足すと、表の書き漏らしが型エラーになる */
const createDispatchTable = (impl: {
  readonly shell: HostShell;
  readonly updater: HostUpdater;
}): HostRpcMethods => ({
  'shell.openPath': (targetPath) => openPathChecked(impl.shell, targetPath),
  'shell.openExternal': (url) => openExternalChecked(impl.shell, url),
  'shell.showOpenDialog': (properties) => impl.shell.showOpenDialog(properties),
  'shell.showSaveDialog': (options) => impl.shell.showSaveDialog(options),
  'shell.writeClipboardImageFromPngFile': (pngPath) =>
    impl.shell.writeClipboardImageFromPngFile(pngPath),
  'shell.writeClipboardText': (text) => impl.shell.writeClipboardText(text),
  'shell.notify': (notification) => impl.shell.notify(notification),
  'shell.getOpenAtLogin': () => impl.shell.getOpenAtLogin(),
  'shell.setOpenAtLogin': (openAtLogin) =>
    impl.shell.setOpenAtLogin(openAtLogin),
  'shell.reloadWindow': () => impl.shell.reloadWindow(),
  'shell.onTermsAccepted': () => impl.shell.onTermsAccepted(),
  'updater.checkForUpdates': () => impl.updater.checkForUpdates(),
  'updater.quitAndInstall': () => impl.updater.quitAndInstall(),
  'updater.getStatus': () => impl.updater.getStatus(),
});

const invoke = <M extends HostRpcMethod>(
  table: HostRpcMethods,
  method: M,
  args: HostRpcArgs<M>,
): Promise<unknown> => {
  // 表の各関数は自分の操作の引数だけを受け取る。method と args の対応は呼び出し側で確かめ済み
  const fn = table[method] as (...a: HostRpcArgs<M>) => Promise<unknown>;
  return fn(...args);
};

type ParsedRequest =
  | { readonly type: 'notRequest' }
  | {
      readonly type: 'invalid';
      readonly id: number | null;
      readonly reason: string;
    }
  | {
      readonly type: 'valid';
      readonly id: number;
      readonly method: HostRpcMethod;
      readonly args: unknown[];
    };

/**
 * 届いた値を要求として読む。同じ通信路には要求以外（起動・終了の知らせ）も流れるので、
 * `kind` が要求でない値は自分宛てではないとして無視する。
 */
const parseRequest = (raw: unknown): ParsedRequest => {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('kind' in raw) ||
    raw.kind !== 'hostRequest'
  ) {
    return { type: 'notRequest' };
  }
  const id =
    'id' in raw && typeof raw.id === 'number' && Number.isInteger(raw.id)
      ? raw.id
      : null;
  const request = HostRequestSchema.safeParse(raw);
  if (!request.success) {
    return { type: 'invalid', id, reason: request.error.message };
  }
  const args = HOST_RPC_ARGS[request.data.method].safeParse(request.data.args);
  if (!args.success) {
    return {
      type: 'invalid',
      id: request.data.id,
      reason: `Invalid arguments for ${request.data.method}: ${args.error.message}`,
    };
  }
  return {
    type: 'valid',
    id: request.data.id,
    method: request.data.method,
    args: args.data,
  };
};

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 通信路から届く要求を、渡された実装で実行し、同じ通信路へ応答を返す。
 *
 * 実装が失敗したときは、処理本体の呼び出しが reject するよう、Error のメッセージを返す。
 * 形の壊れた要求は、ID が読めればその要求を失敗として返し、読めなければ記録して捨てる
 * （応答の宛先が無い）。
 *
 * @returns 要求の受け付けをやめる関数
 */
export const serveHostRpc = (
  channel: MessageChannel<HostResponse, unknown>,
  impl: { readonly shell: HostShell; readonly updater: HostUpdater },
): (() => void) => {
  const table = createDispatchTable(impl);

  const respond = (
    id: number,
    result: { ok: true; value: unknown } | { ok: false; message: string },
  ) => {
    channel.send({ kind: 'hostResponse', id, ...result });
  };

  return channel.onMessage((raw) => {
    match(parseRequest(raw))
      .with({ type: 'notRequest' }, () => {
        // 自分宛てではない
      })
      .with({ type: 'invalid' }, ({ id, reason }) => {
        logger.warn(
          `処理本体から形の壊れた殻の操作の要求が届きました: ${reason}`,
        );
        if (id !== null) {
          respond(id, {
            ok: false,
            message: `Invalid host request: ${reason}`,
          });
        }
      })
      .with({ type: 'valid' }, ({ id, method, args }) => {
        void Effect.runPromise(
          Effect.result(
            Effect.tryPromise({
              // args は parseRequest が method のスキーマで確かめた値
              try: () =>
                invoke(table, method, args as HostRpcArgs<typeof method>),
              catch: toMessage,
            }),
          ),
        ).then((result) => {
          if (result._tag === 'Success') {
            respond(id, { ok: true, value: result.success });
          } else {
            respond(id, { ok: false, message: result.failure });
          }
        });
      })
      .exhaustive();
  });
};
