/**
 * 処理本体（utilityProcess）が、main プロセスの殻の操作（`HostShell`・`HostUpdater`）を呼ぶための要求と応答の形。
 *
 * 処理本体には Electron の `app`・`dialog`・`shell`・ウィンドウ・electron-updater が無いので、
 * これらの操作は要求として main へ送り、main が実際の実装で実行して結果を返す。
 * 処理本体の呼び出し側（`getHost().shell.xxx()`）は、もともと Promise を返す形なので変わらない。
 *
 * 要求と応答は、通信路（`shared/trpcTransport.ts` の `MessageChannel`）の上を流れる構造化複製できる値で、
 * Electron の parentPort は通信路の実装の 1 つにすぎない。入口は main が `./server.ts` の `serveHostRpc`、
 * 処理本体が `./client.ts` の `createHostRpcClient`。
 */
import { z } from 'zod';

import type { HostShell, HostUpdater } from '../host/types';

/** 要求できる操作。`shell.<HostShell のメソッド名>` と `updater.<HostUpdater のメソッド名>` */
export type HostRpcMethods = {
  readonly [K in keyof HostShell as `shell.${K}`]: HostShell[K];
} & {
  readonly [K in keyof HostUpdater as `updater.${K}`]: HostUpdater[K];
};

export type HostRpcMethod = keyof HostRpcMethods;

export type HostRpcArgs<M extends HostRpcMethod> = Parameters<
  HostRpcMethods[M]
>;

export type HostRpcResult<M extends HostRpcMethod> = Awaited<
  ReturnType<HostRpcMethods[M]>
>;

/**
 * 操作ごとの引数のスキーマ。
 *
 * main は処理本体を信頼できる相手として扱うが、プロセスの境界を越えた値は型の保証が切れるので、
 * 受け取るたびに確かめてから実際の OS の操作へ渡す。`satisfies` により、`HostShell`・`HostUpdater` に
 * 操作を足すとここが型エラーになり、スキーマの書き漏らしに気づける。
 */
export const HOST_RPC_ARGS = {
  'shell.openPath': z.tuple([z.string()]),
  'shell.openExternal': z.tuple([z.string()]),
  'shell.showOpenDialog': z.tuple([
    z.array(z.enum(['openDirectory', 'openFile', 'multiSelections'])),
  ]),
  'shell.showSaveDialog': z.tuple([
    z.object({
      defaultPath: z.string(),
      filters: z.array(
        z.object({ name: z.string(), extensions: z.array(z.string()) }),
      ),
    }),
  ]),
  'shell.writeClipboardImageFromPngFile': z.tuple([z.string()]),
  'shell.writeClipboardText': z.tuple([z.string()]),
  'shell.notify': z.tuple([z.object({ title: z.string(), body: z.string() })]),
  'shell.getOpenAtLogin': z.tuple([]),
  'shell.setOpenAtLogin': z.tuple([z.boolean()]),
  'shell.reloadWindow': z.tuple([]),
  'shell.onTermsAccepted': z.tuple([]),
  'updater.checkForUpdates': z.tuple([]),
  'updater.quitAndInstall': z.tuple([]),
  'updater.getStatus': z.tuple([]),
} as const satisfies {
  readonly [M in HostRpcMethod]: z.ZodType<HostRpcArgs<M>>;
};

const HOST_RPC_METHOD_NAMES = Object.keys(HOST_RPC_ARGS) as [
  HostRpcMethod,
  ...HostRpcMethod[],
];

/** 要求 1 件を識別する ID。処理本体のクライアントが 1 から振る */
const RequestIdSchema = z.number().int().nonnegative();

/** 処理本体から main への要求。引数は操作ごとに `HOST_RPC_ARGS` で確かめる */
export const HostRequestSchema = z.object({
  kind: z.literal('hostRequest'),
  id: RequestIdSchema,
  method: z.enum(HOST_RPC_METHOD_NAMES),
  args: z.array(z.unknown()),
});

export type HostRequest = {
  readonly [M in HostRpcMethod]: {
    readonly kind: 'hostRequest';
    readonly id: number;
    readonly method: M;
    readonly args: HostRpcArgs<M>;
  };
}[HostRpcMethod];

/** main から処理本体への応答。失敗は Error のメッセージだけを運ぶ */
export const HostResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    kind: z.literal('hostResponse'),
    id: RequestIdSchema,
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal('hostResponse'),
    id: RequestIdSchema,
    ok: z.literal(false),
    message: z.string(),
  }),
]);

export type HostResponse = z.infer<typeof HostResponseSchema>;
