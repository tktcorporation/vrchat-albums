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
 * 前提: --import ./scripts/mock-electrobun-loader.mjs で electrobun モジュールをモック化済み
 *
 * 呼び出し元: package.json の dev:trpc-server
 * 不要になれば: Electrobun の Playwright テスト対応後に削除可能
 */
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

import { createHTTPServer } from '@trpc/server/adapters/standalone';

import * as sequelizeClient from '../electron/lib/sequelize';
import { initSettingStore } from '../electron/module/settingStore';

/**
 * データベースと設定ストアを初期化してから tRPC ルーターをインポートする。
 *
 * 背景: Electrobun 環境では src/bun/appInit.ts が DB を初期化するが、
 * dev-trpc-server では Electrobun ランタイムがないため手動で初期化が必要。
 * router のインポートは DB 初期化後に行う必要がある（import 時に
 * Sequelize モデルへの参照が解決されるため）。
 *
 * 注意: パスの事前設定はしない。E2E テストでは初期ユーザーと同じ
 * セットアップフローを検証するため、未設定状態で起動する必要がある。
 */
const startServer = async () => {
  // 設定ストアの初期化
  initSettingStore();

  // データベース初期化（テスト用の一時パス）
  const dbPath = path
    .join(os.tmpdir(), 'dev-trpc-user-data', 'db.sqlite')
    .split(path.sep)
    .join(path.posix.sep);
  await sequelizeClient.initRDBClient({ db_url: dbPath });
  console.log(`[dev-trpc-server] Database initialized at: ${dbPath}`);

  // DB 初期化後に router をインポート（モデル参照の解決のため）
  const { router } = await import('../electron/api');

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
};

void startServer();
