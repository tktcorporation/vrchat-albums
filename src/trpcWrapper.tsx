/**
 * tRPC プロバイダラッパー（Electrobun 版）。
 *
 * 背景: Electron では trpc-electron/renderer の ipcLink を使用していた。
 * Electrobun では electrobunLink（Electrobun RPC 経由の tRPC ブリッジ）を使用。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { FC, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import superjson from 'superjson';

import type { AppRouter } from '../electron/api';
import { trpcReact } from './trpc';

const MOCK_API = import.meta.env.VITE_MOCK_API === 'true';

/**
 * Electrobun RPC 経由の tRPC link。
 * trpc-electron の ipcLink の代替。
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
            throw new Error('Electrobun RPC not initialized');
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

interface Props {
  children: ReactNode;
}
export const TrpcWrapper: FC<Props> = ({ children }) => {
  if (MOCK_API) {
    return children;
  }

  // oxlint-disable-next-line react/rules-of-hooks -- MOCK_API はビルド時定数のため、条件付き early return の後でも hooks の呼び出し順序は安定している
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: {
            retry: false,
            onError: (error) => {
              console.error('Mutation error:', error);
            },
          },
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: Number.POSITIVE_INFINITY,
          },
        },
      }),
    [],
  );
  // oxlint-disable-next-line react/rules-of-hooks -- 同上
  const [trpcClient] = useState(() =>
    trpcReact.createClient({
      links: [electrobunLink],
    }),
  );
  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpcReact.Provider>
  );
};
