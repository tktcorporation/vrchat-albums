/**
 * Electrobun ブラウザ側のエントリポイント。
 *
 * 背景: Electron の preload.ts に相当する。
 * Electroview の RPC を設定し、メインプロセスとの通信を確立する。
 * React アプリは Vite でビルドした bundle を index.html から読み込む。
 *
 * 呼び出し元: views://main-ui/index.html
 */
import { Electroview } from 'electrobun/view';

import type { AppRPCSchema } from '../../shared/rpc/types';

/**
 * ブラウザ側の RPC ハンドラ定義。
 * メインプロセスからのトースト通知や初期化進捗を受信する。
 */
const rpc = Electroview.defineRPC<AppRPCSchema>({
  handlers: {
    requests: {},
    messages: {
      toast: ({ data }) => {
        // カスタムイベントとして dispatch し、React コンポーネントで受信する
        window.dispatchEvent(
          new CustomEvent('electrobun-toast', { detail: data }),
        );
      },
      initProgress: ({ data }) => {
        window.dispatchEvent(
          new CustomEvent('electrobun-init-progress', { detail: data }),
        );
      },
    },
  },
});

const electrobun = new Electroview({ rpc });

/**
 * window オブジェクトに Electrobun RPC クライアントを公開する。
 * React アプリから trpcClient として利用される。
 */
(window as any).__electrobun = electrobun;
(window as any).__electrobunRPC = rpc;
