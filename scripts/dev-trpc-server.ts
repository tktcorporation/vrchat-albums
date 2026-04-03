import { EventEmitter } from 'node:events';

/**
 * 開発/テスト用の tRPC HTTP サーバー。
 *
 * 背景: Electrobun 移行後、Playwright テストで Electrobun RPC が利用できない。
 * このサーバーは tRPC ルーターを HTTP で公開し、フロントエンドが
 * HTTP フォールバックで通信できるようにする。
 *
 * 用途:
 *   - Playwright スクリーンショットテスト
 *   - 開発時のブラウザ直接アクセス（electrobun dev の代替）
 *
 * 呼び出し元: package.json の dev:trpc-server / test:playwright
 * 不要になれば: Electrobun の Playwright テスト対応後に削除可能
 */
import { createHTTPServer } from '@trpc/server/adapters/standalone';

import { router } from '../electron/api';

const PORT = Number(process.env.TRPC_PORT ?? 3001);

const server = createHTTPServer({
  middleware: (_req, res, next) => {
    // CORS ヘッダーを設定（開発/テスト用のみ）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    next();
  },
  router,
  createContext: () => ({
    eventEmitter: new EventEmitter(),
  }),
});

server.listen(PORT);
console.log(`[dev-trpc-server] tRPC HTTP server listening on port ${PORT}`);
