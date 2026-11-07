import { createTRPCClient } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';

import type { AppRouter } from '../electron/api';
import { electronRendererChannel } from './trpc/electronRendererChannel';
import { messageLink } from './trpc/messageLink';

/**
 * Reactコンポーネント内でtRPCプロシージャを呼び出すためのクライアント。
 * `useQuery`, `useMutation`, `useSubscription` などのReactフックを提供し、
 * データの取得、更新、キャッシュ管理、ローディング状態の管理などをReactの流儀で簡単に行えます。
 * UIのリアクティブな更新に適しています。
 */
export const trpcReact = createTRPCReact<AppRouter>();

/**
 * メインプロセスと通信する tRPC クライアント。`TrpcWrapper` が `trpcReact` の Provider にも
 * この同じインスタンスを渡し、React の外（Sentry の `beforeSend` など）から命令的に呼ぶときも使う。
 *
 * 呼び出しの ID にはクライアントごとの接頭辞が付く（`src/trpc/messageLink.ts`）ので、
 * クライアントを増やしても応答は混ざらない。1 つにまとめているのは、通信路の受信の登録と
 * 呼び出しの ID の採番を 1 か所に集め、画面からの呼び出しをこのインスタンスで追えるようにするため。
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    messageLink<AppRouter>({
      channel: electronRendererChannel,
      transformer: superjson,
    }),
  ],
});
