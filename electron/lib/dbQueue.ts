import type { Transaction } from '@sequelize/core';
import { Effect } from 'effect';
import PQueue from 'p-queue';
import { match, P } from 'ts-pattern';

import { toError } from './errorMapping';
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
  /**
   * ログ/Sentry上でこのキューを識別するためのラベル（例: 'write' / 'read'）。
   * getConfigHash には含めない（含めると同一設定のキューがラベル違いで
   * 複数インスタンスに分裂し、concurrency による直列化の保証が壊れるため）。
   * @default 'write'
   */
  label?: string;
}

/**
 * SequelizeDatabaseError は生のドライバエラー（sqlite3 の SQLITE_IOERR 等）を
 * .cause に保持する。Sentry 上でエラー種別を判別できるよう、
 * まず cause から、無ければ error 自身から SQLite のエラーコードを取り出す。
 */
const extractSqliteErrorCode = (error: unknown): string | undefined =>
  match(error)
    .with(
      P.intersection(P.instanceOf(Error), { cause: { code: P.string } }),
      (e) => e.cause.code,
    )
    .with(
      P.intersection(P.instanceOf(Error), { code: P.string }),
      (e) => e.code,
    )
    .otherwise(() => undefined);

interface DBQueueLogContext {
  queueLabel: string;
  taskLabel?: string;
}

interface DBQueueErrorInfo {
  normalizedError: Error;
  sqliteErrorCode: string | undefined;
  prefix: string;
  details: Record<string, unknown>;
  tags: Record<string, string>;
}

/**
 * DBQueue 内のエラーログ呼び出しで共通利用する、Sentry トリアージ用の情報一式を組み立てる。
 * message 文言は呼び出し元ごとに異なるため、ここでは details/tags と組み立て済みの
 * prefix のみを返し、文言の最終形は各呼び出し元に委ねる。
 */
const buildDBQueueErrorInfo = (
  error: unknown,
  context: DBQueueLogContext,
): DBQueueErrorInfo => {
  const normalizedError = toError(error);
  const sqliteErrorCode = extractSqliteErrorCode(error);
  const prefix = `DBQueue[${context.queueLabel}${
    context.taskLabel ? `:${context.taskLabel}` : ''
  }]`;

  return {
    normalizedError,
    sqliteErrorCode,
    prefix,
    details: {
      queue: context.queueLabel,
      ...(context.taskLabel ? { task: context.taskLabel } : {}),
      errorName: normalizedError.name,
      ...(sqliteErrorCode ? { sqliteErrorCode } : {}),
    },
    tags: {
      dbQueueName: context.queueLabel,
      ...(sqliteErrorCode ? { sqliteErrorCode } : {}),
    },
  };
};

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
      label: options.label ?? 'write',
    };

    this.queue = new PQueue({
      concurrency: this.options.concurrency,
      timeout: this.options.timeout,
    });
  }

  /**
   * キューにタスクを追加して実行する
   * @param task 実行するタスク関数
   * @param taskLabel ログ/Sentry上でタスクを識別するためのラベル（例: 'logInfo.batchInsert'）
   * @returns タスクの実行結果
   */
  async add<T>(task: () => Promise<T>, taskLabel?: string): Promise<T> {
    // キューが一杯かどうかをチェック（実行中＋待機中の合計）
    if (this.totalTasks >= this.options.maxSize) {
      if (this.options.onFull === 'throw') {
        throw new Error('DBQueue: キューが一杯です');
      }
      // 'wait'の場合は空きができるまで待機する
      await this.waitForSpace();
    }

    const context: DBQueueLogContext = {
      queueLabel: this.options.label,
      taskLabel,
    };

    // effect-lint-allow-try-catch: ts-pattern でエラー分類し予期しないエラーを再スローするパターン
    try {
      const result = await this.queue.add(task).then((r) => r);
      return result;
    } catch (error) {
      match(error)
        .with(
          P.intersection(P.instanceOf(Error), { name: 'TimeoutError' }),
          (e) => {
            const info = buildDBQueueErrorInfo(e, context);
            logger.error({
              message: `${info.prefix}: タスクがタイムアウトしました: ${e.message}`,
              details: info.details,
              tags: info.tags,
            });
          },
        )
        .otherwise((e) => {
          const info = buildDBQueueErrorInfo(e, context);
          logger.error({
            message: `${info.prefix}: タスク実行中にエラーが発生しました${
              info.sqliteErrorCode ? ` (${info.sqliteErrorCode})` : ''
            }: ${info.normalizedError.message}`,
            stack: info.normalizedError,
            details: info.details,
            tags: info.tags,
          });
        });
      // すべてのエラーをre-throw
      throw error;
    }
  }

  /**
   * キューにタスクを追加して実行する（Effect型を返す）
   * @param task 実行するタスク関数
   * @param taskLabel ログ/Sentry上でタスクを識別するためのラベル（例: 'logInfo.batchInsert'）
   * @returns タスクの実行結果をEffect型でラップ
   */
  addWithResult<T>(
    task: () => Promise<T>,
    taskLabel?: string,
  ): Effect.Effect<T, DBQueueError> {
    const context: DBQueueLogContext = {
      queueLabel: this.options.label,
      taskLabel,
    };

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
                const info = buildDBQueueErrorInfo(e, context);
                logger.error({
                  message: `${info.prefix}: タスクがタイムアウトしました: ${e.message}`,
                  stack: e,
                  details: info.details,
                  tags: info.tags,
                });
                return {
                  type: 'TASK_TIMEOUT' as const,
                  message: `${info.prefix}: タスクがタイムアウトしました: ${e.message}`,
                };
              },
            )
            .otherwise((e) => {
              // 予期せぬエラーの場合はログを出力して例外をスロー
              const info = buildDBQueueErrorInfo(e, context);
              logger.error({
                message: `${info.prefix}: タスク実行中に予期せぬエラーが発生しました${
                  info.sqliteErrorCode ? ` (${info.sqliteErrorCode})` : ''
                }: ${info.normalizedError.message}`,
                stack: info.normalizedError,
                details: info.details,
                tags: info.tags,
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
   * Note: 予期しないエラーはそのまま throw され Sentry に送信される。
   * query はデバッグ用SQLコンソール（electron/module/debug/debugController.ts）経由で
   * 任意のユーザー入力になり得るため、taskLabel には含めない
   * （クエリ文字列に含まれ得るプレイヤー名等の個人情報がSentryに送信されるのを防ぐ）。
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
   * Note: 予期しないエラーは addWithResult 内で throw され Sentry に送信される。
   * query をtaskLabelに含めない理由は query() のコメントを参照。
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
    taskLabel?: string,
  ): Effect.Effect<T, DBQueueError> {
    return this.addWithResult(async () => {
      const client = getRDBClient().__client;
      return client.transaction(task);
    }, taskLabel);
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
 *
 * label は意図的に含めない（インスタンスの同一性はキューの実行特性
 * concurrency/maxSize/timeout/onFull のみで決まる。label まで含めると
 * 同一設定でラベルだけ異なる呼び出しがインスタンス分裂を起こし、
 * concurrency による直列化の保証が壊れる）。
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
