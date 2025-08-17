import { createTRPCProxyClient } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { ipcLink } from 'electron-trpc/renderer';
import superjson from 'superjson';
import type { AppRouter } from '../electron/api';

/**
 * Reactコンポーネント内でtRPCプロシージャを呼び出すためのクライアント。
 * `useQuery`, `useMutation`, `useSubscription` などのReactフックを提供し、
 * データの取得、更新、キャッシュ管理、ローディング状態の管理などをReactの流儀で簡単に行えます。
 * UIのリアクティブな更新に適しています。
 */
export const trpcReact = createTRPCReact<AppRouter>();

/**
 * Reactのライフサイクル外 (例: イベントハンドラ、コールバック関数、Sentryの`beforeSend`のような純粋なJS関数内)で
 * tRPCプロシージャを命令的に呼び出すためのプレーンなクライアント。
 * Reactフックを使用せず、直接 `.query()` や `.mutate()` メソッドを呼び出してデータを操作します。
 * バックグラウンド処理や特定のタイミングでのデータ操作が主目的の場合に適しています。
 *
 * `trpcReact` と `trpcClient` は同じ `AppRouter` と `transformer` (`superjson`) を共有し、
 * `ipcLink` を通じてメインプロセスと通信します。
 */
export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
  transformer: superjson,
});
