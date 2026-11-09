import { Cause, Effect, Exit, Option } from 'effect';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  __cleanupTestRDBClient,
  __initTestRDBClient,
  __resetTestRDBClient,
  getDB,
} from './db/client';
import { vrchatPlayerLeaveLogs } from './db/schema';
import DBQueue, { drainDBQueues, getDBQueue, resetDBQueue } from './dbQueue';
import { logger } from './logger';

const insertLeaveLog = (
  tx: Parameters<Parameters<DBQueue['transaction']>[0]>[0],
  playerName: string,
) =>
  tx
    .insert(vrchatPlayerLeaveLogs)
    .values({ leaveDateTime: new Date(), playerName, playerId: null })
    .run();

const countLeaveLogs = () =>
  getDB().select().from(vrchatPlayerLeaveLogs).all().length;

describe('DBQueue', () => {
  beforeAll(async () => {
    await __initTestRDBClient();
  }, 10000);
  beforeEach(() => {
    __resetTestRDBClient();
  });
  afterAll(() => {
    __cleanupTestRDBClient();
  });

  it('同じ設定では同じインスタンスを返すこと', () => {
    resetDBQueue(); // テスト用にリセット
    const queue1 = getDBQueue({ concurrency: 1 });
    const queue2 = getDBQueue({ concurrency: 1 });
    expect(queue1).toBe(queue2);
  });

  it('異なる設定では異なるインスタンスを返すこと', () => {
    resetDBQueue(); // テスト用にリセット
    const queue1 = getDBQueue({ concurrency: 1 });
    const queue2 = getDBQueue({ concurrency: 3 });
    expect(queue1).not.toBe(queue2);
  });

  it('タスクを追加して実行できること', async () => {
    const queue = getDBQueue();
    const task = vi.fn().mockResolvedValue('result');

    const result = await queue.add(task);

    expect(task).toHaveBeenCalledTimes(1);
    expect(result).toBe('result');
  });

  it('addWithResultでタスクを実行してResult型で結果を返すこと', async () => {
    const queue = getDBQueue();
    const task = vi.fn().mockResolvedValue('result');

    const value = await Effect.runPromise(queue.addWithResult(task));

    expect(task).toHaveBeenCalledTimes(1);
    expect(value).toBe('result');
  });

  it('addWithResultでエラーが発生した場合にエラーをResult型で返すこと', async () => {
    const queue = getDBQueue();
    const error = new Error('Task error');
    const task = vi.fn().mockRejectedValue(error);

    // addWithResultは予期せぬエラーをスローするため、rejects.toThrowで検証
    await expect(Effect.runPromise(queue.addWithResult(task))).rejects.toThrow(
      'Task error',
    );

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('キューが一杯の場合にエラーをスローすること', async () => {
    resetDBQueue(); // テスト用にリセット

    // maxSize:2のキューを作成（実行中1つ + 待機中1つ = 合計2つまで）
    const queue = new DBQueue({ maxSize: 2, onFull: 'throw', concurrency: 1 });

    // 長時間実行されるタスクを追加してキューを埋める
    const longRunningTask = () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('long task'), 1000);
      });

    // 最初のタスクを開始（実行中になる）
    const firstTaskPromise = queue.add(longRunningTask);

    // 2つ目のタスクを追加（待機中になる、長時間実行するタスク）
    const secondTaskPromise = queue.add(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('second task'), 1000);
        }),
    );

    // 少し待機してキューの状態を安定させる
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });

    // キューの状態を確認
    console.log('Queue pending:', queue.pending);
    console.log('Queue size:', queue.size);
    console.log('Queue isEmpty:', queue.isEmpty);
    console.log('Queue isIdle:', queue.isIdle);
    // totalTasksはprivateなので直接アクセスできないが、pending + sizeで計算
    console.log('Total tasks:', queue.pending + queue.size);

    // 3つ目のタスクを追加しようとすると、キューが一杯でエラー
    await expect(
      queue.add(() => Promise.resolve('third task')),
    ).rejects.toThrow('キューが一杯です');

    // タスクの完了を待つ（クリーンアップ）
    await Promise.all([firstTaskPromise, secondTaskPromise]);
  });

  it('キューが一杯の場合にaddWithResultでエラーをEffect型で返すこと', async () => {
    resetDBQueue(); // テスト用にリセット

    // maxSize:2のキューを作成（実行中1つ + 待機中1つ = 合計2つまで）
    const queue = new DBQueue({ maxSize: 2, onFull: 'throw', concurrency: 1 });

    // 長時間実行されるタスクを追加してキューを埋める
    const longRunningTask = () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('long task'), 1000);
      });

    // 最初のタスクを開始（実行中になる）
    const firstTaskPromise = queue.add(longRunningTask);

    // 2つ目のタスクを追加（待機中になる、こちらも長時間実行）
    const secondTaskEffect = queue.addWithResult(longRunningTask);
    const secondTaskPromise = Effect.runPromise(secondTaskEffect).catch(
      () => {},
    );

    // 少し待機してキューの状態を安定させる
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });

    // 3つ目のタスクを追加しようとすると、キューが一杯でエラー
    const exit = await Effect.runPromiseExit(
      queue.addWithResult(() => Promise.resolve('third task')),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failOpt = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failOpt)).toBe(true);
      if (Option.isSome(failOpt)) {
        expect(failOpt.value.message).toContain('キューが一杯です');
      }
    }

    // タスクの完了を待つ（クリーンアップ）
    await firstTaskPromise;
    await secondTaskPromise;
  });

  it('トランザクションの中の書き込みをコミットし、タスクの戻り値を返すこと', async () => {
    const queue = getDBQueue();

    const value = await Effect.runPromise(
      queue.transaction((tx) => {
        insertLeaveLog(tx, 'A');
        insertLeaveLog(tx, 'B');
        return 'transaction result';
      }),
    );

    expect(value).toBe('transaction result');
    expect(countLeaveLogs()).toBe(2);
  });

  it('タスクが投げたらトランザクションの書き込みを巻き戻し、エラーをthrowすること', async () => {
    const queue = getDBQueue();

    // 予期しないエラーはthrowされる（Sentryに送信される）
    await expect(
      Effect.runPromise(
        queue.transaction((tx) => {
          insertLeaveLog(tx, 'A');
          throw new Error('Transaction error');
        }),
      ),
    ).rejects.toThrow('Transaction error');

    expect(countLeaveLogs()).toBe(0);
  });

  it('クエリを実行し、行をプレーンなオブジェクトで返すこと', async () => {
    const queue = getDBQueue();
    await Effect.runPromise(
      queue.transaction((tx) => insertLeaveLog(tx, 'Alice')),
    );

    const result = await queue.query(
      'SELECT playerName FROM VRChatPlayerLeaveLogModels',
    );

    expect(result).toEqual([{ playerName: 'Alice' }]);
    expect(Object.getPrototypeOf(result[0])).toBe(Object.prototype);
  });

  it('queryWithResultでクエリを実行してEffect型で結果を返すこと', async () => {
    const queue = getDBQueue();

    const value = await Effect.runPromise(
      queue.queryWithResult('SELECT 1 AS one'),
    );

    expect(value).toEqual([{ one: 1 }]);
  });

  it('queryWithResultで予期しないエラーが発生した場合にエラーをthrowすること', async () => {
    const queue = getDBQueue();

    // 予期しないエラーはthrowされる（Sentryに送信される）
    await expect(
      Effect.runPromise(queue.queryWithResult('SELECT * FROM missing_table')),
    ).rejects.toThrow('no such table');
  });

  it('複数のタスクを順番に処理すること', async () => {
    const queue = getDBQueue({ concurrency: 1 });
    const results: number[] = [];

    // 3つのタスクを追加
    const task1 = async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
      results.push(1);
      return 1;
    };

    const task2 = async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
      results.push(2);
      return 2;
    };

    const task3 = async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
      results.push(3);
      return 3;
    };

    // 同時にタスクを追加
    const promises = [queue.add(task1), queue.add(task2), queue.add(task3)];

    // すべてのタスクが完了するのを待つ
    await Promise.all(promises);

    // タスクが追加された順番で実行されることを確認
    expect(results).toEqual([1, 2, 3]);
  });

  it('キューの状態を正しく報告すること', async () => {
    resetDBQueue(); // テスト用にリセット

    const queue = new DBQueue({ concurrency: 1 });

    // 初期状態
    expect(queue.isEmpty).toBe(true);
    expect(queue.isIdle).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.pending).toBe(0);

    // タスクを追加して実行中の状態
    const task1Promise = queue.add(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('task1'), 50);
        }),
    );

    // タスクが実行中
    expect(queue.isEmpty).toBe(false);
    expect(queue.isIdle).toBe(false);
    expect(queue.pending).toBe(1);

    // 別のタスクを追加（キューに入る）
    const task2Promise = queue.add(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('task2'), 50);
        }),
    );

    // キューにタスクがある状態
    expect(queue.size).toBe(1);
    expect(queue.isEmpty).toBe(false);
    expect(queue.isIdle).toBe(false);

    // すべてのタスクが完了するのを待つ
    await Promise.all([task1Promise, task2Promise]);

    // 再び空の状態
    expect(queue.isEmpty).toBe(true);
    expect(queue.isIdle).toBe(true);
  });

  it('キューが空になるまで待機できること', async () => {
    const queue = getDBQueue();

    // タスクを追加
    void queue.add(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('task'), 50);
        }),
    );

    // キューが空になるまで待機
    await queue.onIdle();

    expect(queue.isIdle).toBe(true);
  });

  describe('Sentryトリアージ用のエラー情報', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('addWithResultでSQLiteエラーコードを持つエラーの場合、コードとタスク名をログに含めること', async () => {
      const queue = getDBQueue();
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      // Drizzle のクエリの失敗と同じ形: node:sqlite のエラー（拡張エラーコードの errcode 付き）を cause に保持する
      const driverError = Object.assign(new Error('disk I/O error'), {
        code: 'ERR_SQLITE_ERROR',
        errcode: 522, // SQLITE_IOERR_SHORT_READ
        errstr: 'disk I/O error',
      });
      const drizzleLikeError = new Error('Failed query: insert ...', {
        cause: driverError,
      });
      const task = vi.fn().mockRejectedValue(drizzleLikeError);

      await expect(
        Effect.runPromise(queue.addWithResult(task, 'test.batchInsert')),
      ).rejects.toThrow('Failed query');

      const taskLabeledCall = errorSpy.mock.calls.find(
        ([params]) => params.details?.task === 'test.batchInsert',
      );
      expect(taskLabeledCall?.[0]).toMatchObject({
        message: expect.stringContaining('SQLITE_IOERR'),
        details: {
          queue: 'write',
          task: 'test.batchInsert',
          sqliteErrorCode: 'SQLITE_IOERR',
        },
        tags: {
          dbQueueName: 'write',
          sqliteErrorCode: 'SQLITE_IOERR',
        },
      });
    });

    it('実際の DB のエラー（Drizzle が包んだ node:sqlite のエラー）からもエラーコードを抽出すること', async () => {
      const queue = getDBQueue();
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(
        Effect.runPromise(
          queue.transaction((tx) => {
            tx.insert(vrchatPlayerLeaveLogs)
              .values({
                id: 'same',
                leaveDateTime: new Date(),
                playerName: 'A',
                playerId: null,
              })
              .run();
            tx.insert(vrchatPlayerLeaveLogs)
              .values({
                id: 'same',
                leaveDateTime: new Date(),
                playerName: 'B',
                playerId: null,
              })
              .run();
          }, 'test.realError'),
        ),
      ).rejects.toThrow();

      const taskLabeledCall = errorSpy.mock.calls.find(
        ([params]) => params.details?.task === 'test.realError',
      );
      expect(taskLabeledCall?.[0].details).toMatchObject({
        sqliteErrorCode: 'SQLITE_CONSTRAINT',
      });
    });

    it('読み取り用キューではqueueラベルが read になること', async () => {
      resetDBQueue();
      const queue = getDBQueue({ concurrency: 3, label: 'read' });
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const error = new Error('read query failed');
      const task = vi.fn().mockRejectedValue(error);

      await expect(
        Effect.runPromise(queue.addWithResult(task)),
      ).rejects.toThrow('read query failed');

      const readQueueCall = errorSpy.mock.calls.find(
        ([params]) => params.details?.queue === 'read',
      );
      expect(readQueueCall).toBeDefined();
    });

    it('queryWithResultはクエリ文字列（デバッグコンソール経由のユーザー入力）をログに含めないこと', async () => {
      const queue = getDBQueue();
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const sensitiveQuery =
        "SELECT * FROM vrchat_world_join_logs WHERE player_name = 'SecretPlayerName'";

      await expect(
        Effect.runPromise(queue.queryWithResult(sensitiveQuery)),
      ).rejects.toThrow('no such table');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [params] = errorSpy.mock.calls[0];
      expect(params.message).not.toContain('SecretPlayerName');
      expect(JSON.stringify(params.details)).not.toContain('SecretPlayerName');
    });

    it('SQLiteエラーコードを持たない予期しないエラーではsqliteErrorCodeを含めないこと', async () => {
      const queue = getDBQueue();
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const error = new Error('plain unexpected error');
      const task = vi.fn().mockRejectedValue(error);

      await expect(
        Effect.runPromise(queue.addWithResult(task, 'test.plainError')),
      ).rejects.toThrow('plain unexpected error');

      const taskLabeledCall = errorSpy.mock.calls.find(
        ([params]) => params.details?.task === 'test.plainError',
      );
      expect(taskLabeledCall?.[0].details).not.toHaveProperty(
        'sqliteErrorCode',
      );
    });

    it('cause を持たずエラー自身に errcode がある場合もSQLiteエラーコードを抽出すること', async () => {
      const queue = getDBQueue();
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const errorWithDirectCode = Object.assign(
        new Error('SQLITE_BUSY: database is locked'),
        { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' },
      );
      const task = vi.fn().mockRejectedValue(errorWithDirectCode);

      await expect(
        Effect.runPromise(queue.addWithResult(task, 'test.directCode')),
      ).rejects.toThrow('SQLITE_BUSY: database is locked');

      const taskLabeledCall = errorSpy.mock.calls.find(
        ([params]) => params.details?.task === 'test.directCode',
      );
      expect(taskLabeledCall?.[0].details).toMatchObject({
        sqliteErrorCode: 'SQLITE_BUSY',
      });
    });

    it('addではエラー発生時にキュー/タスクの情報を付与してログ出力すること', async () => {
      const queue = getDBQueue();
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const error = new Error('add() unexpected error');
      const task = vi.fn().mockRejectedValue(error);

      await expect(queue.add(task, 'test.addTask')).rejects.toThrow(
        'add() unexpected error',
      );

      const taskLabeledCall = errorSpy.mock.calls.find(
        ([params]) => params.details?.task === 'test.addTask',
      );
      expect(taskLabeledCall?.[0]).toMatchObject({
        message: expect.stringContaining('test.addTask'),
        details: { queue: 'write', task: 'test.addTask' },
      });
    });

    it('label はインスタンスの同一性判定（getConfigHash）に影響しないこと', () => {
      resetDBQueue();
      const queueA = getDBQueue({ concurrency: 5, label: 'a' });
      const queueB = getDBQueue({ concurrency: 5, label: 'b' });

      expect(queueA).toBe(queueB);
    });
  });
});

describe('drainDBQueues', () => {
  // 止めたキューを後のテストへ持ち越さない
  afterEach(() => {
    resetDBQueue();
  });

  it('実行中のタスクの終わりを待ち、未開始のタスクは始めない', async () => {
    resetDBQueue();
    const queue = getDBQueue({ concurrency: 1 });
    let finishRunning: () => void = () => {};
    const running = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRunning = resolve;
        }),
    );
    const queued = vi.fn(async () => {});
    void queue.add(running);
    void queue.add(queued);
    await vi.waitFor(() => expect(running).toHaveBeenCalled());

    const draining = drainDBQueues(10_000);
    finishRunning();

    await expect(draining).resolves.toBe(true);
    expect(queued).not.toHaveBeenCalled();
  });

  it('実行中のタスクが上限までに終わらなければ、待たずに false を返す', async () => {
    resetDBQueue();
    const queue = getDBQueue({ concurrency: 1 });
    const running = vi.fn(() => new Promise<void>(() => {}));
    void queue.add(running);
    await vi.waitFor(() => expect(running).toHaveBeenCalled());

    await expect(drainDBQueues(10)).resolves.toBe(false);
  });
});
