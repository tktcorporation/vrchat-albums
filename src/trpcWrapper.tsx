import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { FC, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ipcLink } from 'trpc-electron/renderer';
import { trpcReact } from './trpc';

const MOCK_API = import.meta.env.VITE_MOCK_API === 'true';

type Props = {
  children: ReactNode;
};
export const TrpcWrapper: FC<Props> = ({ children }) => {
  if (MOCK_API) {
    // console.log('USING MOCK MODE');

    return <>{children}</>;
  }

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
  const [trpcClient] = useState(() =>
    trpcReact.createClient({
      links: [ipcLink()],
    }),
  );
  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpcReact.Provider>
  );
};

/**
 * サーバーエラーページ用のTRPCラッパー
 * @param {Props} props
 * @returns {JSX.Element}
 */
export const TrpcWrapperForServerError: FC<Props> = ({ children }) => {
  const [queryClient] = useState(
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
  );
  const [trpcClient] = useState(() =>
    trpcReact.createClient({
      links: [ipcLink()],
    }),
  );
  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpcReact.Provider>
  );
};

type DevProps = {
  children: ReactNode;
};

export const TrpcWrapperDev: FC<DevProps> = ({ children }) => {
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

  const [trpcClient] = useState(() =>
    trpcReact.createClient({
      links: [ipcLink()],
    }),
  );
  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </trpcReact.Provider>
  );
};
