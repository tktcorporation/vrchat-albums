/**
 * tRPC プロバイダラッパー（Electrobun 版）。
 *
 * 背景: Electron では trpc-electron/renderer の ipcLink を使用していた。
 * Electrobun では electrobunLink（Electrobun RPC 経由の tRPC ブリッジ）を使用。
 * Electrobun RPC が利用できない場合は HTTP フォールバックに自動切替する。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FC, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { trpcReact } from './trpc';
import { getLinks } from './trpc-electrobun';

const MOCK_API = import.meta.env.VITE_MOCK_API === 'true';

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
      links: getLinks(),
    }),
  );
  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpcReact.Provider>
  );
};
