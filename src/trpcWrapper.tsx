import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FC, ReactNode } from 'react';
import { useMemo } from 'react';

import { trpcClient, trpcReact } from './trpc';

const MOCK_API = import.meta.env.VITE_MOCK_API === 'true';

interface Props {
  children: ReactNode;
}
export const TrpcWrapper: FC<Props> = ({ children }) => {
  if (MOCK_API) {
    // console.log('USING MOCK MODE');

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
  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpcReact.Provider>
  );
};
