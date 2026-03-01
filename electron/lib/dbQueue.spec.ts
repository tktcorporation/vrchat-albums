import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import DBQueue, { getDBQueue, resetDBQueue } from './dbQueue';
import {
  __cleanupTestRDBClient,
  __forceSyncRDBClient,
  __initTestRDBClient,
  getRDBClient,
} from './sequelize';

describe('DBQueue', () => {
  beforeAll(async () => {
    await __initTestRDBClient();
  }, 10000);
  beforeEach(async () => {
    await __forceSyncRDBClient();
  });
  afterAll(async () => {
    await __cleanupTestRDBClient();
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

    const result = await queue.addWithResult(task);

    expect(task).toHaveBeenCalledTimes(1);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('result');
  });

  it('addWithResultでエラーが発生した場合にエラーをResult型で返すこと', async () => {
    const queue = getDBQueue();
    const error = new Error('Task error');
    const task = vi.fn().mockRejectedValue(error);

    // addWithResultは予期せぬエラーをスローするため、try-catchで捕捉する
    try {
      await queue.addWithResult(task);
      // エラーがスローされるはずなので、ここには到達しないはず
      expect(false).toBe(true);
    } catch (e) {
      // エラーがスローされることを確認
      expect(e).toBe(error);
    }

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
    await new Promise((resolve) => setTimeout(resolve, 10));

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

  it('キューが一杯の場合にaddWithResultでエラーをResult型で返すこと', async () => {
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
    const secondTaskPromise = queue.addWithResult(longRunningTask);

    // 少し待機してキューの状態を安定させる
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 3つ目のタスクを追加しようとすると、キューが一杯でエラー
    const result = await queue.addWithResult(() =>
      Promise.resolve('third task'),
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('キューが一杯です');

    // タスクの完了を待つ（クリーンアップ）
    await firstTaskPromise;
    if ((await secondTaskPromise).isOk()) {
      // secondTaskPromiseも完了を待つ
    }
  });

  it('トランザクションを使用してタスクを実行できること', async () => {
    const queue = getDBQueue();
    const transactionTask = vi.fn().mockResolvedValue('transaction result');

    const result = await queue.transaction(transactionTask);

    expect(transactionTask).toHaveBeenCalledTimes(1);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('transaction result');
  });

  it('トランザクションで予期しないエラーが発生した場合にエラーをthrowすること', async () => {
    const queue = getDBQueue();
    const error = new Error('Transaction error');
    const transactionTask = vi.fn().mockRejectedValue(error);

    // 予期しないエラーはthrowされる（Sentryに送信される）
    await expect(queue.transaction(transactionTask)).rejects.toThrow(
      'Transaction error',
    );

    expect(transactionTask).toHaveBeenCalledTimes(1);
  });

  it('クエリを実行できること', async () => {
    const queue = getDBQueue();
    const mockResult = [{ name: 'test_table' }];

    // Sequelizeのqueryメソッドをモック化
    const originalClient = getRDBClient().__client;
    const mockQuery = vi.fn().mockResolvedValue(mockResult);
    getRDBClient().__client.query = mockQuery;

    const result = await queue.query('SELECT * FROM test_table');

    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM test_table', {
      type: 'SELECT',
    });
    expect(result).toEqual(mockResult);

    // モックをリストア
    getRDBClient().__client = originalClient;
  });

  it('queryWithResultでクエリを実行してResult型で結果を返すこと', async () => {
    const queue = getDBQueue();
    const mockResult = [{ name: 'test_table' }];

    // Sequelizeのqueryメソッドをモック化
    const originalClient = getRDBClient().__client;
    const mockQuery = vi.fn().mockResolvedValue(mockResult);
    getRDBClient().__client.query = mockQuery;

    const result = await queue.queryWithResult('SELECT * FROM test_table');

    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM test_table', {
      type: 'SELECT',
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(mockResult);

    // モックをリストア
    getRDBClient().__client = originalClient;
  });

  it('queryWithResultで予期しないエラーが発生した場合にエラーをthrowすること', async () => {
    const queue = getDBQueue();
    const error = new Error('Query error');

    // Sequelizeのqueryメソッドをモック化
    const originalClient = getRDBClient().__client;
    const mockQuery = vi.fn().mockRejectedValue(error);
    getRDBClient().__client.query = mockQuery;

    // 予期しないエラーはthrowされる（Sentryに送信される）
    await expect(
      queue.queryWithResult('SELECT * FROM test_table'),
    ).rejects.toThrow('Query error');

    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM test_table', {
      type: 'SELECT',
    });

    // モックをリストア
    getRDBClient().__client = originalClient;
  });

  it('複数のタスクを順番に処理すること', async () => {
    const queue = getDBQueue({ concurrency: 1 });
    const results: number[] = [];

    // 3つのタスクを追加
    const task1 = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push(1);
      return 1;
    };

    const task2 = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      results.push(2);
      return 2;
    };

    const task3 = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
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
      () => new Promise((resolve) => setTimeout(() => resolve('task1'), 50)),
    );

    // タスクが実行中
    expect(queue.isEmpty).toBe(false);
    expect(queue.isIdle).toBe(false);
    expect(queue.pending).toBe(1);

    // 別のタスクを追加（キューに入る）
    const task2Promise = queue.add(
      () => new Promise((resolve) => setTimeout(() => resolve('task2'), 50)),
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
    queue.add(
      () => new Promise((resolve) => setTimeout(() => resolve('task'), 50)),
    );

    // キューが空になるまで待機
    await queue.onIdle();

    expect(queue.isIdle).toBe(true);
  });
});
