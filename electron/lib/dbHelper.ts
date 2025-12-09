import type { Result } from 'neverthrow';
import { type DBQueueError, getDBQueue } from './dbQueue';

/**
 * データベースアクセスのユーティリティ関数を提供するモジュール
 * - DBQueueを使用して安全にデータベースアクセスを行う
 * - トランザクション処理やバッチ処理をサポート
 */

/**
 * データベースヘルパーのエラー型
 */
export type DBHelperError =
  | { type: 'TRANSACTION_FAILED'; message: string }
  | { type: 'BATCH_OPERATION_FAILED'; message: string }
  | { type: 'RETRY_FAILED'; message: string }
  | DBQueueError;

// /**
//  * トランザクションを使用してデータベース操作を実行する
//  * @param callback トランザクションを使用するコールバック関数
//  * @returns コールバック関数の実行結果
//  */
// export async function withTransaction<T>(
//   callback: (transaction: Transaction) => Promise<T>,
// ): Promise<Result<T, DBHelperError>> {
//   const result = await getDBQueue().transaction(callback);

//   if (result.isErr()) {
//     // DBQueueErrorをそのまま返す
//     return result as Result<T, DBHelperError>;
//   }

//   return result as Result<T, DBHelperError>;
// }

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
export async function executeQuery(
  query: string,
): Promise<Result<unknown[], DBHelperError>> {
  const dbQueue = getDBQueue(READ_QUEUE_CONFIG);

  return dbQueue.queryWithResult(query) as Promise<
    Result<unknown[], DBHelperError>
  >;
}

// /**
//  * 複数のデータベース操作をバッチ処理として実行する
//  * すべての操作は同一トランザクション内で実行される
//  * @param operations 実行する操作の配列
//  * @returns 各操作の実行結果の配列
//  */
// export async function executeBatch<T>(
//   operations: ((transaction: Transaction) => Promise<T>)[],
// ): Promise<Result<T[], DBHelperError>> {
//   const transactionResult = await withTransaction(async (transaction) => {
//     const results: T[] = [];
//     for (const operation of operations) {
//       try {
//         const result = await operation(transaction);
//         results.push(result);
//       } catch (error) {
//         logger.error({
//           message: 'バッチ処理中にエラーが発生しました',
//           stack: error instanceof Error ? error : new Error(String(error)),
//         });
//         throw error; // トランザクション全体がロールバックされる
//       }
//     }
//     return results;
//   });

//   if (transactionResult.isErr()) {
//     return err({
//       type: 'BATCH_OPERATION_FAILED',
//       message: `バッチ処理に失敗しました: ${transactionResult.error.message}`,
//     });
//   }

//   return transactionResult;
// }

// /**
//  * リトライ機能付きでデータベース操作を実行する
//  * @param operation 実行する操作
//  * @param options リトライオプション
//  * @returns 操作の実行結果
//  */
// export async function withRetry<T>(
//   operation: () => Promise<Result<T, DBHelperError>>,
//   options: {
//     maxRetries?: number;
//     retryDelay?: number;
//     shouldRetry?: (error: DBHelperError) => boolean;
//   } = {},
// ): Promise<Result<T, DBHelperError>> {
//   const maxRetries = options.maxRetries ?? 3;
//   const retryDelay = options.retryDelay ?? 1000;
//   const shouldRetry = options.shouldRetry ?? ((_error) => true);

//   let lastError: DBHelperError = {
//     type: 'RETRY_FAILED',
//     message: '不明なエラーが発生しました',
//   };

//   for (let attempt = 0; attempt < maxRetries; attempt++) {
//     const result = await operation();

//     if (result.isOk()) {
//       return result;
//     }

//     lastError = result.error;

//     // 最後の試行でエラーが発生した場合はエラーを返す
//     if (attempt === maxRetries - 1) {
//       break;
//     }

//     // リトライ条件を満たさない場合はエラーを返す
//     if (!shouldRetry(lastError)) {
//       break;
//     }

//     logger.debug(
//       `データベース操作を再試行します (${attempt + 1}/${maxRetries})`,
//     );
//     await new Promise((resolve) => setTimeout(resolve, retryDelay));
//   }

//   return err({
//     type: 'RETRY_FAILED',
//     message: `リトライ後も操作に失敗しました: ${lastError.message}`,
//   });
// }

/**
 * データベースキューにタスクを追加して実行する
 * @param operation 実行する操作
 * @returns 操作の実行結果
 */
export async function enqueueTask<T>(
  operation: () => Promise<T>,
): Promise<Result<T, DBHelperError>> {
  // 読み取り操作は同じ設定で並行実行
  const dbQueue = getDBQueue(READ_QUEUE_CONFIG);

  const result = await dbQueue.addWithResult(operation);
  if (result.isErr()) {
    // DBQueueErrorをDBHelperErrorに変換する必要があるか確認
    // 今回はDBHelperErrorがDBQueueErrorを包含しているのでそのままキャスト
    return result as Result<T, DBHelperError>;
  }
  return result as Result<T, DBHelperError>;
}

// /**
//  * データベースキューの状態を取得する
//  * @returns キューの状態情報
//  */
// export function getQueueStatus(): {
//   size: number;
//   pending: number;
//   isIdle: boolean;
// } {
//   const queue = getDBQueue();
//   return {
//     size: queue.size,
//     pending: queue.pending,
//     isIdle: queue.isIdle,
//   };
// }

// /**
//  * データベースキューが空になるまで待機する
//  */
// export async function waitForQueueIdle(): Promise<void> {
//   return getDBQueue().onIdle();
// }

// /**
//  * データベースキューを一時停止する
//  */
// export function pauseQueue(): void {
//   getDBQueue().pause();
// }

// /**
//  * データベースキューを再開する
//  */
// export function startQueue(): void {
//   getDBQueue().start();
// }
