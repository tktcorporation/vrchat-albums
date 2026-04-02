/**
 * Electrobun 用の tRPC クライアント。
 *
 * 背景: Electron では trpc-electron/renderer の ipcLink を使用していた。
 * Electrobun では RPC を経由して tRPC ルーターを呼び出す。
 * カスタム link を作成し、Electrobun RPC の trpcCall を経由する。
 *
 * 対になるファイル: src/trpc.ts (Electron 版, 移行元)
 */
import { createTRPCProxyClient, type TRPCLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';

import type { AppRouter } from '../electron/api';

/**
 * Electrobun RPC 経由で tRPC プロシージャを呼び出すカスタム link。
 *
 * trpc-electron の ipcLink に相当する。
 * window.__electrobun.rpc.request.trpcCall() を使用して
 * メインプロセスの tRPC ルーターを呼び出す。
 */
const electrobunLink: TRPCLink<AppRouter> = () => {
  return ({ op }) => {
    return observable((observer) => {
      const { path, type, input } = op;

      const doRequest = async () => {
        // effect-lint-allow-try-catch: RPC ブリッジ呼び出しは失敗しうるインフラ操作
        try {
          const electrobun = (window as unknown as Record<string, unknown>)
            .__electrobun as
            | {
                rpc: {
                  request: {
                    trpcCall: (params: {
                      path: string;
                      type: string;
                      input: string | null;
                    }) => Promise<{
                      result: string | null;
                      error: string | null;
                    }>;
                  };
                };
              }
            | undefined;
          if (!electrobun?.rpc?.request?.trpcCall) {
            throw new Error(
              'Electrobun RPC not initialized. Ensure electrobun view script is loaded before the app.',
            );
          }

          const serializedInput =
            input !== undefined ? superjson.stringify(input) : null;

          const response = await electrobun.rpc.request.trpcCall({
            path,
            type: type,
            input: serializedInput,
          });

          if (response.error) {
            const parsedError = superjson.parse(response.error);
            observer.error(new Error(parsedError.message));
            return;
          }

          const result = response.result
            ? superjson.parse(response.result)
            : undefined;
          observer.next({ result: { type: 'data', data: result } });
          observer.complete();
        } catch (error) {
          observer.error(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      };

      void doRequest();
    });
  };
};

/**
 * React コンポーネント内で tRPC プロシージャを呼び出すためのクライアント。
 * useQuery, useMutation 等の React フックを提供する。
 *
 * Electron 版の trpcReact と同じインターフェースを維持。
 */
export const trpcReact = createTRPCReact<AppRouter>();

/**
 * React のライフサイクル外で tRPC プロシージャを命令的に呼び出すクライアント。
 *
 * Electron 版の trpcClient と同じインターフェースを維持。
 */
export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [electrobunLink],
});
