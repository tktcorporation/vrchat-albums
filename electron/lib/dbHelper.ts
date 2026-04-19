import type { Effect } from 'effect';

import { type DBQueueError, getDBQueue } from './dbQueue';

/**
 * データベースアクセスのユーティリティ関数を提供するモジュール
 * - DBQueueを使用して安全にデータベースアクセスを行う
 * - 読み取り専用クエリ実行と任意の Promise タスクのキューイングを提供
 */

/**
 * データベースヘルパーのエラー型。
 *
 * `BATCH_OPERATION_FAILED` は `vrchatWorldJoinLog/service.ts` で
 * 複数件の登録が部分失敗した場合に使用される。
 */
export type DBHelperError =
  | { type: 'BATCH_OPERATION_FAILED'; message: string }
  | DBQueueError;

// 読み取り用のキュー設定
const READ_QUEUE_CONFIG = {
  concurrency: 3, // 読み取り専用クエリなので並行実行可能
  timeout: 20000, // 20秒に短縮
};

/**
 * 読み取り専用のSQLクエリを実行する
 * @param query 実行するSQLクエリ
 * @returns クエリの実行結果
 */
export function executeQuery(
  query: string,
): Effect.Effect<unknown[], DBHelperError> {
  const dbQueue = getDBQueue(READ_QUEUE_CONFIG);

  return dbQueue.queryWithResult(query) as Effect.Effect<
    unknown[],
    DBHelperError
  >;
}

/**
 * データベースキューにタスクを追加して実行する
 * @param operation 実行する操作
 * @returns 操作の実行結果
 */
export function enqueueTask<T>(
  operation: () => Promise<T>,
): Effect.Effect<T, DBHelperError> {
  // 読み取り操作は同じ設定で並行実行
  const dbQueue = getDBQueue(READ_QUEUE_CONFIG);

  return dbQueue.addWithResult(operation) as Effect.Effect<T, DBHelperError>;
}
