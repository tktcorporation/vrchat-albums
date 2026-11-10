/// <reference types="vite/client" />
import { createHash } from 'node:crypto';

import type { MigrationMeta } from 'drizzle-orm/migrator';

/**
 * `./migrations/<フォルダ名>/migration.sql` の中身。Vite がビルド時に文字列として処理本体の
 * バンドル（`main/backend.cjs`）へ埋め込む。
 *
 * 埋め込むのは、実行時にマイグレーションのフォルダを探さずに済ませるため。フォルダを読む方式では、
 * 開発時とパッケージ後（asar の中）でフォルダの場所が変わり、electron-builder の設定にも
 * フォルダを含める必要が出る。
 */
const embeddedMigrationFiles: Record<string, string> = import.meta.glob(
  './migrations/*/migration.sql',
  { query: '?raw', import: 'default', eager: true },
);

/** drizzle-kit がフォルダ名の先頭に付ける `YYYYMMDDHHMMSS` を UTC のミリ秒にする */
const folderNameToMillis = (folderName: string): number => {
  const stamp = folderName.slice(0, 14);
  if (!/^\d{14}$/.test(stamp)) {
    throw new Error(
      `Migration folder name must start with YYYYMMDDHHMMSS: ${folderName}`,
    );
  }
  return Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
    Number(stamp.slice(12, 14)),
  );
};

/**
 * 埋め込んだマイグレーションを、drizzle の `readMigrationFiles()` がフォルダから作るのと同じ形で、
 * フォルダ名の順に返す。
 *
 * 適用済みかどうかはフォルダ名だけで判定される（`__drizzle_migrations.name`）。
 * 一度リリースしたマイグレーションのフォルダ名は変えない。
 */
export const loadEmbeddedMigrations = (): MigrationMeta[] =>
  Object.entries(embeddedMigrationFiles)
    .map(([filePath, query]) => {
      const folderName = filePath.split('/').at(-2);
      if (folderName === undefined) {
        throw new Error(`Unexpected migration path: ${filePath}`);
      }
      return { folderName, query };
    })
    .toSorted((a, b) => a.folderName.localeCompare(b.folderName))
    .map(({ folderName, query }) => ({
      sql: query.split('--> statement-breakpoint'),
      bps: true,
      name: folderName,
      folderMillis: folderNameToMillis(folderName),
      hash: createHash('sha256').update(query).digest('hex'),
    }));
