/**
 * Electrobun 用の tRPC クライアント。
 *
 * 背景: Electron では trpc-electron/renderer の ipcLink を使用していた。
 * Electrobun では RPC を経由して tRPC ルーターを呼び出す。
 * カスタム link を作成し、Electrobun RPC の trpcCall を経由する。
 *
 * HTTP フォールバック: Electrobun RPC が利用できない場合（ブラウザ直接アクセス、
 * Playwright テスト時）は HTTP 経由で dev-trpc-server に接続する。
 *
 * 対になるファイル: src/trpc.ts (Electron 版, 移行元)
 */
import {
  createTRPCProxyClient,
  httpBatchLink,
  type TRPCLink,
} from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';

import type { AppRouter } from '../electron/api';

/**
 * Electrobun RPC が利用可能かどうかを判定する。
 * Electrobun ランタイム上では window.__electrobun が設定される。
 */
const isElectrobunAvailable = (): boolean => {
  // effect-lint-allow-try-catch: ランタイム環境検出パターン
  try {
    const electrobun = (window as unknown as Record<string, unknown>)
      .__electrobun as
      | {
          rpc: {
            request: {
              trpcCall: unknown;
            };
          };
        }
      | undefined;
    return typeof electrobun?.rpc?.request?.trpcCall === 'function';
  } catch {
    return false;
  }
};

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
            .__electrobun as {
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
          };

          const serializedInput =
            input !== undefined ? superjson.stringify(input) : null;

          const response = await electrobun.rpc.request.trpcCall({
            path,
            type: type,
            input: serializedInput,
          });

          if (response.error) {
            const parsedError = superjson.parse(response.error);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            observer.error(
              new Error((parsedError as { message?: string }).message) as any,
            );
            return;
          }

          const result = response.result
            ? superjson.parse(response.result)
            : undefined;
          observer.next({ result: { type: 'data', data: result } });
          observer.complete();
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          observer.error(
            (error instanceof Error ? error : new Error(String(error))) as any,
          );
        }
      };

      void doRequest();
    });
  };
};

/**
 * HTTP フォールバック用の tRPC link。
 * Electrobun RPC が利用できない場合（ブラウザ直接アクセス、Playwright テスト時）に使用。
 * dev-trpc-server (port 3001) に HTTP 経由で接続する。
 */
const httpFallbackUrl =
  import.meta.env.VITE_TRPC_BASE_URL ??
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${
        import.meta.env.VITE_TRPC_PORT ?? '3001'
      }/`
    : `http://localhost:${import.meta.env.VITE_TRPC_PORT ?? '3001'}/`);

const httpFallbackLink = httpBatchLink({
  url: httpFallbackUrl,
  transformer: superjson,
});

/**
 * ランタイム環境に応じた tRPC link を選択する。
 * Electrobun RPC が利用可能な場合は RPC 経由、そうでなければ HTTP フォールバック。
 *
 * trpcWrapper.tsx からも参照される。
 */
export const getLinks = (): TRPCLink<AppRouter>[] => {
  if (isElectrobunAvailable()) {
    return [electrobunLink];
  }
  console.info(
    '[tRPC] Electrobun RPC not available, using HTTP fallback (port %s)',
    import.meta.env.VITE_TRPC_PORT ?? '3001',
  );
  return [httpFallbackLink];
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
  links: getLinks(),
});
