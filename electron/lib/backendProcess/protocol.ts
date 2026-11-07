/**
 * main プロセスと処理本体（utilityProcess）の間で、起動・終了と main からの指示を伝えるメッセージの形。
 *
 * 両者は 1 本の通信路（Electron では utilityProcess と parentPort）を共有し、その上に 3 種類のメッセージが流れる。
 * - このファイルの制御メッセージ（起動時の情報・準備完了・終了・main からの指示）
 * - 殻の操作の要求と応答（`electron/lib/hostRpc/protocol.ts`）
 * - エラー監視の SDK が自分で使うメッセージ（`@sentry/electron` が受け手から隠す）
 *
 * 受け手はそれぞれ自分の `kind` だけを読み、他のメッセージは無視する。
 * tRPC のメッセージはこの通信路を通らず、画面と処理本体の間の MessagePort を流れる（`electron/lib/trpcTransport/`）。
 */
import { z } from 'zod';

import type { HostInfo } from '../host/types';

const HostInfoSchema = z.object({
  paths: z.object({
    userData: z.string(),
    logs: z.string(),
    downloads: z.string(),
    pictures: z.string(),
    temp: z.string(),
  }),
  appVersion: z.string(),
  isPackaged: z.boolean(),
  resourcesPath: z.string(),
}) satisfies z.ZodType<HostInfo>;

/** main から処理本体へ送るメッセージ */
export const MainToBackendSchema = z.discriminatedUnion('kind', [
  z.object({
    /** 起動直後に 1 度だけ送る。処理本体はこれを受け取るまで何も始めない */
    kind: z.literal('init'),
    info: HostInfoSchema,
    /** main がエラー監視を初期化したか。していなければ処理本体も初期化しない（送る経路が無い） */
    errorReporting: z.boolean(),
  }),
  z.object({
    /** 画面の文書 1 つ分の tRPC の接続。port はメッセージの ports で渡す */
    kind: z.literal('connect'),
    connectionId: z.string().min(1),
  }),
  z.object({
    /** 画面の文書が入れ替わったので、前の接続を閉じる */
    kind: z.literal('disconnect'),
    connectionId: z.string().min(1),
  }),
  z.object({
    /** ウィンドウをすべて閉じて常駐に入ったので、定期的なログの同期を始める */
    kind: z.literal('startBackgroundSync'),
  }),
  z.object({
    /** 閉じたウィンドウの位置と大きさを、次の起動のために設定へ保存する */
    kind: z.literal('setWindowBounds'),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
  }),
  z.object({
    /** アプリの終了。DB を閉じてからプロセスを終える */
    kind: z.literal('shutdown'),
  }),
]);

export type MainToBackendMessage = z.infer<typeof MainToBackendSchema>;

/** 処理本体から main へ送るメッセージ */
export const BackendToMainSchema = z.discriminatedUnion('kind', [
  z.object({
    /** 設定と DB を開き終え、tRPC の接続を受け付けられる */
    kind: z.literal('ready'),
  }),
]);

export type BackendToMainMessage = z.infer<typeof BackendToMainSchema>;

/**
 * 届いた値が制御メッセージなら読み、そうでなければ null を返す。
 * 同じ通信路の別の種類のメッセージ（殻の操作の要求・エラー監視）は null になる。
 */
export const parseControlMessage = <T>(
  schema: z.ZodType<T>,
  raw: unknown,
): T | null => {
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
};
