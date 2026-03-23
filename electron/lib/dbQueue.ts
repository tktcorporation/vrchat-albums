import type { Transaction } from '@sequelize/core';
import { Effect } from 'effect';
import PQueue from 'p-queue';
import { match, P } from 'ts-pattern';

import { logger } from './logger';
import { getRDBClient } from './sequelize';

/**
 * データベースキューのエラー型
 *
 * Note: QUERY_ERROR と TRANSACTION_ERROR は削除済み
 * 予期しないエラーはそのまま throw され Sentry に送信される
 */
export type DBQueueError =
  | { type: 'QUEUE_FULL'; message: string }
  | { type: 'TASK_TIMEOUT'; message: string };

/**
 * データベースアクセスのためのキュー設定
 */
interface DBQueueOptions {
  /**
   * 同時実行可能なタスク数
   * @default 1
   */
  concurrency?: number;
  /**
   * キューの最大サイズ
   * @default Infinity
   */
  maxSize?: number;
  /**
   * タスクのタイムアウト時間（ミリ秒）
   * @default 60000 (60秒)
   */
  timeout?: number;
  /**
   * キューが一杯の場合の動作
   * - throw: エラーをスローする
   * - wait: 空きができるまで待機する
   * @default 'wait'
   */
  onFull?: 'throw' | 'wait';
}

/**
 * データベースアクセスのためのキュー
 * - 同時実行数を制限してデータベースアクセスをキューイングする
 * - トランザクション処理をサポート
 *
 * @see docs/log-sync-architecture.md - ログ同期設計ドキュメント
 * @see electron/module/logSync/service.ts - 主要サービスクラス
 */
class DBQueue {
  private queue: PQueue;
  private options: Required<DBQueueOptions>;

  constructor(options: DBQueueOptions = {}) {
    this.options = {
      concurrency: options.concurrency ?? 1,
      maxSize: options.maxSize ?? Number.POSITIVE_INFINITY,
      timeout: options.timeout ?? 60000,
      onFull: options.onFull ?? 'wait',
    };

    this.queue = new PQueue({
      concurrency: this.options.concurrency,
      timeout: this.options.timeout,
    });

    // エラーが発生した場合のみログ出力
    this.queue.on('error', (error) => {
      logger.error({
        message: 'DBQueue: エラーが発生しました',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    });
  }

  /**
   * キューにタスクを追加して実行する
   * @param task 実行するタスク関数
   * @returns タスクの実行結果
   */
  async add<T>(task: () => Promise<T>): Promise<T> {
    // キューが一杯かどうかをチェック（実行中＋待機中の合計）
    if (this.totalTasks >= this.options.maxSize) {
      if (this.options.onFull === 'throw') {
        throw new Error('DBQueue: キューが一杯です');
      }
      // 'wait'の場合は空きができるまで待機する
      await this.waitForSpace();
    }

    // effect-lint-allow-try-catch: ts-pattern でエラー分類し予期しないエラーを再スローするパターン
    try {
      const result = await this.queue.add(task).then((r) => r);
      return result;
    } catch (error) {
      match(error)
        .with(
          P.intersection(P.instanceOf(Error), { name: 'TimeoutError' }),
          () => {
            logger.error({
              message: 'DBQueue: タスクがタイムアウトしました',
            });
          },
        )
        .otherwise(() => {});
      // すべてのエラーをre-throw
      throw error;
    }
  }

  /**
   * キューにタスクを追加して実行する（Effect型を返す）
   * @param task 実行するタスク関数
   * @returns タスクの実行結果をEffect型でラップ
   */
  addWithResult<T>(task: () => Promise<T>): Effect.Effect<T, DBQueueError> {
    return Effect.gen(this, function* () {
      if (this.totalTasks >= this.options.maxSize) {
        if (this.options.onFull === 'throw') {
          return yield* Effect.fail({
            type: 'QUEUE_FULL' as const,
            message: 'DBQueue: キューが一杯です',
          });
        }
        // 'wait'の場合は空きができるまで待機する
        yield* Effect.tryPromise({
          try: () => this.waitForSpace(),
          catch: (e) => {
            throw e;
          },
        });
      }

      return yield* Effect.tryPromise({
        try: () => this.queue.add(task).then((r) => r),
        catch: (error): DBQueueError => {
          return match(error)
            .with(
              P.intersection(P.instanceOf(Error), { name: 'TimeoutError' }),
              (e) => {
                logger.error({
                  message: 'DBQueue: タスクがタイムアウトしました',
                  stack: e,
                });
                return {
                  type: 'TASK_TIMEOUT' as const,
                  message: `DBQueue: タスクがタイムアウトしました: ${e.message}`,
                };
              },
            )
            .otherwise((e) => {
              // 予期せぬエラーの場合はログを出力して例外をスロー
              logger.error({
                message: 'DBQueue: タスク実行中に予期せぬエラーが発生しました',
                stack: e instanceof Error ? e : new Error(String(e)),
              });
              throw e; // 予期せぬエラーはそのままスロー
            });
        },
      });
    });
  }

  /**
   * 読み取り専用のクエリを実行する
   * @param query 実行するSQLクエリ
   * @returns クエリの実行結果
   *
   * Note: 予期しないエラーはそのまま throw され Sentry に送信される
   */
  async query(query: string): Promise<unknown[]> {
    return this.add(async () => {
      const client = getRDBClient().__client;
      const result = await client.query(query, {
        type: 'SELECT',
      });
      return result;
    });
  }

  /**
   * 読み取り専用のクエリを実行する（Effect型を返す）
   * @param query 実行するSQLクエリ
   * @returns クエリの実行結果をEffect型でラップ
   *
   * Note: 予期しないエラーは addWithResult 内で throw され Sentry に送信される
   */
  queryWithResult(query: string): Effect.Effect<unknown[], DBQueueError> {
    return this.addWithResult(async () => {
      const client = getRDBClient().__client;
      const result = await client.query(query, {
        type: 'SELECT',
      });
      return result;
    });
  }

  /**
   * トランザクションを使用してタスクを実行する
   * @param task トランザクションを使用するタスク関数
   * @returns タスクの実行結果をEffect型でラップ
   *
   * Note: 予期しないエラーは addWithResult 内で throw され Sentry に送信される
   */
  transaction<T>(
    task: (transaction: Transaction) => Promise<T>,
  ): Effect.Effect<T, DBQueueError> {
    return this.addWithResult(async () => {
      const client = getRDBClient().__client;
      return client.transaction(task);
    });
  }

  /**
   * キューに空きができるまで待機する
   */
  private async waitForSpace(): Promise<void> {
    return new Promise((resolve) => {
      const checkQueue = () => {
        if (this.totalTasks < this.options.maxSize) {
          resolve();
        } else {
          setTimeout(checkQueue, 100);
        }
      };
      checkQueue();
    });
  }

  /**
   * 現在のキューサイズを取得する
   */
  get size(): number {
    return this.queue.size;
  }

  /**
   * 処理中のタスク数を取得する（実行中のタスク数）
   */
  get pending(): number {
    return this.queue.pending;
  }

  /**
   * 実行中と待機中の合計タスク数を取得する
   */
  private get totalTasks(): number {
    // p-queueのpendingは実行中のタスク数、sizeは待機中のタスク数
    return this.queue.pending + this.queue.size;
  }

  /**
   * キューが空かどうかを確認する
   */
  get isEmpty(): boolean {
    return this.queue.size === 0 && this.queue.pending === 0;
  }

  /**
   * キューが処理中かどうかを確認する
   */
  get isIdle(): boolean {
    return this.queue.pending === 0 && this.queue.size === 0;
  }

  /**
   * キューをクリアする
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * キューが空になるまで待機する
   */
  async onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  /**
   * キューを一時停止する
   */
  pause(): void {
    this.queue.pause();
  }

  /**
   * キューを再開する
   */
  start(): void {
    this.queue.start();
  }
}

// 設定ベースのインスタンス管理
const instances = new Map<string, DBQueue>();

/**
 * 設定からハッシュを生成する
 */
function getConfigHash(options: DBQueueOptions = {}): string {
  const normalizedOptions = {
    concurrency: options.concurrency ?? 1,
    maxSize: options.maxSize ?? Number.POSITIVE_INFINITY,
    timeout: options.timeout ?? 60000,
    onFull: options.onFull ?? 'wait',
  };
  return JSON.stringify(normalizedOptions);
}

/**
 * 設定に応じたDBQueueインスタンスを取得する
 * @param options キューのオプション
 * @returns DBQueueのインスタンス
 */
export const getDBQueue = (options?: DBQueueOptions): DBQueue => {
  const configHash = getConfigHash(options);

  if (!instances.has(configHash)) {
    instances.set(configHash, new DBQueue(options));
  }

  const instance = instances.get(configHash);
  if (!instance) {
    throw new Error('DBQueue instance not found'); // 論理的にここは到達しないはず
  }
  return instance;
};

/**
 * テスト用にすべてのDBQueueインスタンスをリセットする
 */
export const resetDBQueue = (): void => {
  for (const instance of instances.values()) {
    instance.clear();
  }
  instances.clear();
};

export default DBQueue;
