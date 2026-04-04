/**
 * tRPC ルーターへのブリッジ。
 *
 * 背景: Electrobun の RPC と既存の tRPC ルーターを接続する。
 * Electrobun RPC の trpcCall request を受け取り、
 * tRPC の createCallerFactory を使って直接プロシージャを呼び出す。
 * これにより既存のビジネスロジック（electron/module/）を変更せずに移行できる。
 *
 * 参照: electron/api.ts (tRPC ルーター定義)
 */
import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

import { router } from '../../electron/api';
import type { TRPCCallParams, TRPCCallResponse } from '../../shared/rpc/types';

/**
 * tRPC の createCallerFactory は initTRPC 経由で取得する。
 * @trpc/server の直接エクスポートには含まれないため。
 */
const t = initTRPC.create({ transformer: superjson });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createCaller = t.createCallerFactory(router as any);

/**
 * tRPC ブリッジを生成する。
 * Electrobun RPC からの呼び出しを tRPC caller に変換する。
 */
export const createTRPCBridge = () => {
  const caller = createCaller({});

  return {
    /**
     * tRPC プロシージャを呼び出す。
     *
     * パスをドット区切りで辿り、対応するプロシージャ関数を実行する。
     * 入力・出力は superjson でシリアライズ/デシリアライズする。
     */
    call: async (params: TRPCCallParams): Promise<TRPCCallResponse> => {
      // effect-lint-allow-try-catch: tRPC caller 実行は失敗しうるインフラ操作
      try {
        const { path, type: _type, input } = params;
        const parsedInput = input ? superjson.parse(input) : undefined;

        // ドット区切りのパスで caller オブジェクトを辿る
        const pathParts = path.split('.');
        // biome-ignore lint: tRPC caller は動的にネストされたオブジェクト
        let current: any = caller;
        for (const part of pathParts) {
          current = current[part];
          if (current === undefined) {
            return {
              result: null,
              error: superjson.stringify({
                code: 'NOT_FOUND',
                message: `Procedure not found: ${path}`,
              }),
            };
          }
        }

        // query/mutation を呼び出し
        // tRPC の caller は query も mutation も同じ関数として呼び出せる
        const result = await current(parsedInput);
        return {
          result: superjson.stringify(result),
          error: null,
        };
      } catch (caughtError) {
        const normalizedError =
          caughtError instanceof Error
            ? caughtError
            : new Error(String(caughtError));
        return {
          result: null,
          error: superjson.stringify({
            code: 'INTERNAL_SERVER_ERROR',
            message: normalizedError.message,
          }),
        };
      }
    },
  };
};
