import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';

import { utcDateTime } from './utcDateTime';

/**
 * アプリの DB のテーブル定義。マイグレーション（`./migrations/`）は `pnpm db:generate` が
 * この定義から生成する。手順は `./README.md`。
 *
 * テーブル名・列名・インデックス名は、利用者の手元にある既存の DB と同じ名前にしている。
 * 名前を変えるとテーブルの作り直しになり、既存の DB の引き継ぎ（`./legacyTakeover.ts`）が
 * 比べる基準ともずれるため、名前は変えない。
 *
 * どのテーブルも次の列を持つ。
 * - `id`: 行を作るときにアプリが uuidv7 を振る。DB 側の既定値は持たない
 * - `createdAt` / `updatedAt`: 行を作るときと更新するときにアプリが現在時刻を入れる。
 *   DB 側の既定値は持たないので、SQL を直接書いて行を作るときは自分で入れる
 */
const timestamps = {
  createdAt: utcDateTime('createdAt')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: utcDateTime('updatedAt')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
};

const uuidPrimaryKey = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * VRChat のログから読んだワールドへの参加。
 *
 * @see docs/log-sync-architecture.md - ログ同期の設計
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 */
export const vrchatWorldJoinLogs = sqliteTable(
  'VRChatWorldJoinLogModels',
  {
    id: uuidPrimaryKey(),
    worldId: text('worldId').notNull(),
    worldName: text('worldName').notNull(),
    worldInstanceId: text('worldInstanceId').notNull(),
    joinDateTime: utcDateTime('joinDateTime').notNull(),
    ...timestamps,
  },
  (table) => [
    // 同じインスタンスへの同じ時刻の参加を 1 行にする。一括登録は重複を無視して挿入する
    uniqueIndex('worldInstanceId-joinDateTime').on(
      table.worldInstanceId,
      table.joinDateTime,
    ),
    index('world-joinDateTime-idx').on(table.joinDateTime),
  ],
);

/**
 * 写真のファイル名の日時とワールド ID から推定したワールドへの参加。
 * ログが残っていない期間の写真をワールドごとにまとめるために使う。
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 */
export const vrchatWorldJoinLogsFromPhoto = sqliteTable(
  'VRChatWorldJoinLogFromPhotoModels',
  {
    id: uuidPrimaryKey(),
    worldId: text('worldId').notNull(),
    joinDateTime: utcDateTime('joinDateTime').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('worldInstanceId-joinDateTime-fromPhoto').on(
      table.worldId,
      table.joinDateTime,
    ),
    index('photo-joinDateTime-idx').on(table.joinDateTime),
  ],
);

/**
 * VRChat のログから読んだプレイヤーの参加。
 *
 * @see docs/photo-grouping-logic.md - セッション単位の写真グループ化
 */
export const vrchatPlayerJoinLogs = sqliteTable(
  'VRChatPlayerJoinLogModels',
  {
    id: uuidPrimaryKey(),
    // 古いログには ID が出ないため null を許す
    playerId: text('playerId'),
    playerName: text('playerName').notNull(),
    joinDateTime: utcDateTime('joinDateTime').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('playerName-joinDateTime').on(
      table.playerName,
      table.joinDateTime,
    ),
    index('joinDateTime-idx').on(table.joinDateTime),
  ],
);

/** VRChat のログから読んだプレイヤーの退出 */
export const vrchatPlayerLeaveLogs = sqliteTable('VRChatPlayerLeaveLogModels', {
  id: uuidPrimaryKey(),
  leaveDateTime: utcDateTime('leaveDateTime').notNull(),
  playerName: text('playerName').notNull(),
  playerId: text('playerId'),
  ...timestamps,
});

/**
 * 写真ファイルの場所・撮影日時・大きさ。
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 */
export const vrchatPhotoPaths = sqliteTable(
  'VRChatPhotoPathModels',
  {
    id: uuidPrimaryKey(),
    photoPath: text('photoPath').notNull(),
    photoTakenAt: utcDateTime('photoTakenAt').notNull(),
    height: integer('height').notNull().default(720),
    width: integer('width').notNull().default(1280),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('v_r_chat_photo_path_models_photo_path_unique').on(
      table.photoPath,
    ),
  ],
);

/**
 * VRChat が写真に埋め込むメタデータ（XMP）。`photoPath` で写真と 1 対 1 に対応する。
 *
 * @see electron/module/vrchatPhotoMetadata/schema.ts - メタデータの Zod スキーマ定義
 */
export const vrchatPhotoMetadata = sqliteTable(
  'VRChatPhotoMetadataModels',
  {
    id: uuidPrimaryKey(),
    photoPath: text('photoPath').notNull(),
    /** 撮影者の VRChat ユーザー ID（usr_xxx）。メタデータがある写真には必ずある */
    authorId: text('authorId').notNull(),
    /** 撮影者の表示名。メタデータに表示名が無い写真では authorId が入る */
    authorDisplayName: text('authorDisplayName').notNull(),
    worldId: text('worldId'),
    worldDisplayName: text('worldDisplayName'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('v_r_chat_photo_metadata_models_photo_path_unique').on(
      table.photoPath,
    ),
    index('v_r_chat_photo_metadata_models_world_id').on(table.worldId),
  ],
);

/** アプリが読み書きするテーブルの一覧。テストで中身を空にするときにも使う */
export const appTables = [
  vrchatWorldJoinLogs,
  vrchatWorldJoinLogsFromPhoto,
  vrchatPlayerJoinLogs,
  vrchatPlayerLeaveLogs,
  vrchatPhotoPaths,
  vrchatPhotoMetadata,
] as const;

/** アプリのテーブルの名前 */
export type AppTableName = (typeof appTables)[number]['_']['name'];

/**
 * テーブルの行を、DB の外のどこから作り直せるか。
 * - `logStore`: アプリがログを書き写して残す保存先（`<userData>/logStore`）。全件のログ同期で読み直す
 * - `photoFolder`: 写真のフォルダ。全件の写真インデックスの作成で、ファイル名・画像・埋め込みのメタデータから読み直す
 * - `none`: 利用者が DB にだけ書いたもので、作り直せない
 */
export type TableRebuildSource = 'logStore' | 'photoFolder' | 'none';

/**
 * 引き継げなかった DB を作り直してよいかを決める、テーブルごとの作り直しの元。
 * テーブルを足したときは、ここに書くまで型エラーになる。`none` のテーブルが 1 つでもあれば、
 * 引き継げなかった DB は作り直さずに起動を止める（`../db/client.ts` の `migrateRDBClient`）。
 *
 * @see electron/module/logInfo/service.ts - loadLogInfoIndexFromVRChatLog（ログ同期と写真インデックスの作成）
 */
export const TABLE_REBUILD_SOURCES = {
  VRChatWorldJoinLogModels: 'logStore',
  VRChatWorldJoinLogFromPhotoModels: 'photoFolder',
  VRChatPlayerJoinLogModels: 'logStore',
  VRChatPlayerLeaveLogModels: 'logStore',
  VRChatPhotoPathModels: 'photoFolder',
  VRChatPhotoMetadataModels: 'photoFolder',
} as const satisfies Record<AppTableName, TableRebuildSource>;
