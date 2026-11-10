import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit の設定。`pnpm db:generate` が `electron/lib/db/schema.ts` からマイグレーションを生成する。
 * マイグレーションは処理本体のバンドルへ埋め込んで実行するので（`electron/lib/db/migrations.ts`）、
 * drizzle-kit から DB へ接続することはない。手順は `electron/lib/db/README.md`。
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/lib/db/schema.ts',
  out: './electron/lib/db/migrations',
});
