import { createTRPCClient } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';
import { ipcLink } from 'trpc-electron/renderer';

import type { AppRouter } from '../electron/api';

/**
 * Reactコンポーネント内でtRPCプロシージャを呼び出すためのクライアント。
 * `useQuery`, `useMutation`, `useSubscription` などのReactフックを提供し、
 * データの取得、更新、キャッシュ管理、ローディング状態の管理などをReactの流儀で簡単に行えます。
 * UIのリアクティブな更新に適しています。
 */
export const trpcReact = createTRPCReact<AppRouter>();

/**
 * メインプロセスと IPC で通信する唯一の tRPC クライアント。`TrpcWrapper` が `trpcReact` の Provider にも
 * この同じインスタンスを渡す。
 *
 * trpc-electron は応答をリクエスト ID で呼び出し元へ振り分け、ID はクライアントごとに 1 から数える。
 * クライアントを 2 つ作ると、同時に走ったリクエストの ID が重なり、別のリクエストの応答（失敗が成功に見えるものを含む）が
 * 届いてしまう。React の外（Sentry の `beforeSend` など）から命令的に呼ぶときも、このインスタンスを使う。
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [ipcLink({ transformer: superjson })],
});
