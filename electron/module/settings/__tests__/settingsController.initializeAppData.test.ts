import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_CODES, UserFacingError } from '../../../lib/errors';
import { logger } from '../../../lib/logger';
import * as sequelizeClient from '../../../lib/sequelize';
import {
  beginInitProgressRun,
  type InitProgressRun,
} from '../../initProgress/emitter';
import {
  LOG_SYNC_MODE,
  type LogSyncLock,
  runWithLogSyncLock,
  syncLogsHoldingLock,
} from '../../logSync/service';
import * as settingStore from '../../settingStore';
import * as vrchatWorldJoinLogService from '../../vrchatWorldJoinLog/service';

// モジュールのモック
vi.mock('../../../lib/logger');
vi.mock('../../../lib/sequelize');
vi.mock('../../logSync/service');
vi.mock('../../vrchatWorldJoinLog/service');
vi.mock('../../settingStore');
vi.mock('../../initProgress/emitter');

// Electron環境のモック
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    getPath: vi.fn().mockReturnValue('/tmp/logs'),
    isPackaged: true, // 本番環境として扱う
  },
}));

// 型定義
const mockLogger = logger as unknown as {
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  warnWithSentry: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const mockSequelizeClient = sequelizeClient as unknown as {
  syncRDBClient: ReturnType<typeof vi.fn>;
};

const mockSyncLogs = syncLogsHoldingLock as ReturnType<typeof vi.fn>;

/** runWithLogSyncLock が task に渡す値の代わり（中身は使われない） */
const lockStub = {} as LogSyncLock;

const mockVrchatWorldJoinLogService = vrchatWorldJoinLogService as unknown as {
  findVRChatWorldJoinLogList: ReturnType<typeof vi.fn>;
};

const mockSettingStore = settingStore as unknown as {
  getSettingStore: ReturnType<typeof vi.fn>;
};

/** beginInitProgressRun が返すハンドルの代わり。操作は呼び出しを記録するだけ */
const createRunStub = (
  runId: number,
  onEnd: (outcome: 'completed' | 'error') => void = () => {},
): InitProgressRun => ({
  kind: 'startup',
  runId,
  stage: vi.fn(),
  dbUpdated: vi.fn(),
  setLaunch: vi.fn(),
  flushStats: vi.fn(() => Promise.resolve()),
  end: vi.fn(onEnd),
});

// settingsControllerから initializeAppData を取得するためのヘルパー
async function getInitializeAppDataFunction() {
  // 動的にインポートしてモック後の実装を取得
  const { settingsRouter } = await import('../settingsController');
  const router = settingsRouter();

  // tRPCルーターから initializeAppData mutation を取得

  // mutationを直接実行
  return async () => {
    // Callerを作成してmutationを呼び出す
    const caller = router.createCaller({
      eventEmitter: await import('node:events').then(
        (m) => new m.EventEmitter(),
      ),
    });
    return caller.initializeAppData();
  };
}

describe('settingsController.initializeAppData', () => {
  let initializeAppData: (() => Promise<{ success: boolean }>) | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();

    // デフォルトのモック設定
    mockLogger.info = vi.fn();
    mockLogger.debug = vi.fn();
    mockLogger.warn = vi.fn();
    mockLogger.warnWithSentry = vi.fn();
    mockLogger.error = vi.fn();

    mockSequelizeClient.syncRDBClient = vi.fn().mockResolvedValue(undefined);

    mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList = vi
      .fn()
      .mockResolvedValue([]);

    // syncLogs returns Effect, not Promise
    mockSyncLogs.mockReturnValue(Effect.succeed({ success: true }));
    vi.mocked(runWithLogSyncLock).mockImplementation((task) => task(lockStub));
    vi.mocked(beginInitProgressRun).mockImplementation(() => createRunStub(1));

    // getSettingStoreのモック
    mockSettingStore.getSettingStore = vi.fn().mockReturnValue({
      getTermsAccepted: vi.fn().mockReturnValue(true),
      getVRChatPhotoDir: vi.fn().mockReturnValue('/path/to/photos'),
      getAutoStartEnabled: vi.fn().mockReturnValue(null),
      setAutoStartEnabled: vi.fn(),
    });

    // テスト対象の関数を取得
    initializeAppData = await getInitializeAppDataFunction();
  });

  it('正常な初期化処理が完了する', async () => {
    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    const result = await initializeAppData();

    expect(result).toEqual({ success: true });

    // 各ステップが実行されることを確認
    expect(mockLogger.info).toHaveBeenCalledWith(
      '=== Starting application data initialization ===',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Step 1: Syncing database schema...',
    );
    expect(mockSequelizeClient.syncRDBClient).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Step 2: Checking if this is first launch...',
    );
    expect(
      mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList,
    ).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Step 3: Starting log sync...',
    );
    expect(mockSyncLogs).toHaveBeenCalledWith(
      lockStub,
      LOG_SYNC_MODE.FULL,
      expect.objectContaining({ kind: 'startup' }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      '=== Application data initialization completed ===',
    );
  });

  it('利用規約に未同意なら初期化を始めずに拒む', async () => {
    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    mockSettingStore.getSettingStore = vi.fn().mockReturnValue({
      getTermsAccepted: vi.fn().mockReturnValue(false),
    });

    await expect(initializeAppData()).rejects.toThrow(
      '利用規約に同意してから読み込みを始めてください',
    );
    expect(mockSequelizeClient.syncRDBClient).not.toHaveBeenCalled();
    expect(beginInitProgressRun).not.toHaveBeenCalled();
  });

  it('初回起動時は FULL モードでログ同期が実行される', async () => {
    // 既存ログなし（初回起動）
    mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList.mockResolvedValue(
      [],
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    await initializeAppData();

    expect(mockSyncLogs).toHaveBeenCalledWith(
      lockStub,
      LOG_SYNC_MODE.FULL,
      expect.objectContaining({ kind: 'startup' }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith('Found 0 existing logs');
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Detected first launch, using FULL sync mode',
    );
  });

  it('既存ログがある場合は INCREMENTAL モードでログ同期が実行される', async () => {
    // 既存ログあり
    const existingLogs = [
      { id: '1', joinDateTime: new Date() },
      { id: '2', joinDateTime: new Date() },
    ];
    mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList.mockResolvedValue(
      existingLogs,
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    await initializeAppData();

    expect(mockSyncLogs).toHaveBeenCalledWith(
      lockStub,
      LOG_SYNC_MODE.INCREMENTAL,
      expect.objectContaining({ kind: 'startup' }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith('Found 2 existing logs');
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Detected regular launch, using INCREMENTAL sync mode',
    );
  });

  it('データベースエラー時は初回起動として扱われる', async () => {
    // データベースクエリエラー
    mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList.mockRejectedValue(
      new Error('Database connection error'),
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    await initializeAppData();

    expect(mockSyncLogs).toHaveBeenCalledWith(
      lockStub,
      LOG_SYNC_MODE.FULL,
      expect.objectContaining({ kind: 'startup' }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Database error detected, treating as first launch:',
      expect.any(Error),
    );
  });

  it('LOG_FILE_DIR_NOT_FOUND エラー時はセットアップが必要なエラーをスローする', async () => {
    // ログ同期でLOG_FILE_DIR_NOT_FOUNDエラー
    // syncLogs returns Effect - use Effect.fail with error object that has code and message
    mockSyncLogs.mockReturnValue(
      Effect.fail({
        code: 'LOG_FILE_DIR_NOT_FOUND',
        message: 'Log directory not found',
      }),
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }

    // UserFacingErrorがスローされることを確認
    let thrownError: Error | null = null;
    try {
      await initializeAppData();
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeDefined();
    const cause = (thrownError as { cause?: unknown })
      ?.cause as UserFacingError;
    expect(cause).toBeInstanceOf(UserFacingError);
    expect(cause?.errorInfo?.code).toBe(
      ERROR_CODES.VRCHAT_DIRECTORY_SETUP_REQUIRED,
    );
    expect(cause?.errorInfo?.category).toBe('SETUP_REQUIRED');
    expect(cause?.userMessage).toBe(
      'VRChatのログディレクトリが見つかりません。初期設定が必要です。',
    );

    // 情報ログが出力されることを確認
    expect(mockLogger.info).toHaveBeenCalledWith(
      'VRChat directory setup required - throwing UserFacingError to trigger setup screen',
    );
  });

  it('LOG_FILES_NOT_FOUND エラー時もセットアップが必要なエラーをスローする', async () => {
    // ログ同期でLOG_FILES_NOT_FOUNDエラー
    mockSyncLogs.mockReturnValue(
      Effect.fail({
        code: 'LOG_FILES_NOT_FOUND',
        message: 'No log files found',
      }),
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }

    // UserFacingErrorがスローされることを確認
    let thrownError: Error | null = null;
    try {
      await initializeAppData();
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeDefined();
    const cause = (thrownError as { cause?: unknown })
      ?.cause as UserFacingError;
    expect(cause).toBeInstanceOf(UserFacingError);
    expect(cause?.errorInfo?.code).toBe(
      ERROR_CODES.VRCHAT_DIRECTORY_SETUP_REQUIRED,
    );
  });

  it('その他のログ同期エラーは警告として記録され処理は継続される', async () => {
    // ログ同期で別のエラー
    mockSyncLogs.mockReturnValue(
      Effect.fail({
        code: 'OTHER_ERROR',
        message: 'Some other error',
      }),
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    const result = await initializeAppData();

    expect(result).toEqual({ success: true });
    expect(mockLogger.warnWithSentry).toHaveBeenCalledWith({
      message: 'Log sync failed: Some other error',
      details: { errorTag: 'OTHER_ERROR' },
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      '=== Application data initialization completed ===',
    );
  });

  it('データベース同期エラー時はエラーをスローする', async () => {
    // データベース同期エラー
    mockSequelizeClient.syncRDBClient.mockRejectedValue(
      new Error('Database sync failed'),
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }

    let thrownError: Error | null = null;
    try {
      await initializeAppData();
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeDefined();
    const cause = (thrownError as { cause?: unknown })
      ?.cause as UserFacingError;
    expect(cause).toBeInstanceOf(UserFacingError);
    expect(cause?.message).toBe('初期化に失敗しました: Database sync failed');

    expect(mockLogger.error).toHaveBeenCalledWith({
      message: 'Application data initialization failed',
      stack: expect.any(Error),
    });
  });

  it('予期しないエラー時は適切なエラーメッセージをスローする', async () => {
    // 文字列エラー（Error オブジェクトではない）
    mockSequelizeClient.syncRDBClient.mockRejectedValue('String error');

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }

    let thrownError: Error | null = null;
    try {
      await initializeAppData();
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeDefined();
    const cause = (thrownError as { cause?: unknown })
      ?.cause as UserFacingError;
    expect(cause).toBeInstanceOf(UserFacingError);
    expect(cause?.message).toBe(
      '初期化に失敗しました: Unknown initialization error',
    );
  });

  it('実行中に重複して呼ばれたら、実行中の初期化に合流して同じ結果を返す', async () => {
    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    const firstPromise = initializeAppData();
    const secondPromise = initializeAppData();

    const [firstResult, secondResult] = await Promise.all([
      firstPromise,
      secondPromise,
    ]);

    // 2 回目は即答せず、1 回目の完了を待って同じ結果を受け取る
    expect(firstResult).toEqual({ success: true });
    expect(secondResult).toEqual({ success: true });
    // 初期化本体は 1 回しか走らない
    expect(mockSequelizeClient.syncRDBClient).toHaveBeenCalledTimes(1);
    expect(mockSyncLogs).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Initialization already in progress, joining the running initialization',
    );
  });

  it('実行中の初期化が失敗したら、合流した呼び出しにも同じエラーが届く', async () => {
    mockSequelizeClient.syncRDBClient.mockRejectedValue(
      new Error('Database sync failed'),
    );
    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    const results = await Promise.allSettled([
      initializeAppData(),
      initializeAppData(),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(mockSequelizeClient.syncRDBClient).toHaveBeenCalledTimes(1);
  });

  it('正常完了後はフラグがリセットされる', async () => {
    // 最初の実行を完了
    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    await initializeAppData();

    // 2回目の実行は正常に動作する（重複扱いにならない）
    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    const result = await initializeAppData();
    expect(result).toEqual({ success: true });
  });

  it('エラー発生後もフラグがリセットされる', async () => {
    // エラーを発生させる
    mockSequelizeClient.syncRDBClient.mockRejectedValue(
      new Error('Test error'),
    );

    try {
      if (!initializeAppData) {
        throw new Error('initializeAppData not initialized');
      }
      await initializeAppData();
    } catch {
      // エラーは期待される
    }

    // エラー後に再実行可能
    mockSequelizeClient.syncRDBClient.mockResolvedValue(undefined);
    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    const result = await initializeAppData();
    expect(result).toEqual({ success: true });
  });

  it('初期化はログ同期のセマフォの permit を持ったまま、進捗の実行を開始から終了まで進める', async () => {
    const order: string[] = [];
    vi.mocked(runWithLogSyncLock).mockImplementation(async (task) => {
      order.push('lock:acquire');
      const result = await task(lockStub);
      order.push('lock:release');
      return result;
    });
    let flushes = 0;
    const run = createRunStub(1, (outcome) => {
      order.push(`run:${outcome}(flushes=${flushes})`);
    });
    vi.mocked(run.flushStats).mockImplementation(() => {
      flushes += 1;
      return Promise.resolve();
    });
    vi.mocked(beginInitProgressRun).mockImplementation(() => {
      order.push('run:begin');
      return run;
    });

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    await initializeAppData();

    // DB 準備後と終了直前の 2 回、統計を届けてから completed を送る
    expect(order).toEqual([
      'lock:acquire',
      'run:begin',
      'run:completed(flushes=2)',
      'lock:release',
    ]);
    expect(beginInitProgressRun).toHaveBeenCalledTimes(1);
    expect(beginInitProgressRun).toHaveBeenCalledWith('startup', null);
    expect(run.setLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ isFirstLaunch: true }),
    );
    // ログ同期の進捗は初期化の実行へ送らせる
    expect(mockSyncLogs).toHaveBeenCalledWith(
      lockStub,
      LOG_SYNC_MODE.FULL,
      run,
    );
  });

  it('失敗した初期化の後の再呼び出しは、新しい進捗の実行で始め直す', async () => {
    const failedRun = createRunStub(1);
    const retryRun = createRunStub(2);
    vi.mocked(beginInitProgressRun)
      .mockReturnValueOnce(failedRun)
      .mockReturnValueOnce(retryRun);
    mockSequelizeClient.syncRDBClient.mockRejectedValueOnce(
      new Error('Database sync failed'),
    );

    if (!initializeAppData) {
      throw new Error('initializeAppData not initialized');
    }
    await expect(initializeAppData()).rejects.toBeDefined();
    const result = await initializeAppData();

    expect(result).toEqual({ success: true });
    expect(mockSequelizeClient.syncRDBClient).toHaveBeenCalledTimes(2);
    expect(beginInitProgressRun).toHaveBeenCalledTimes(2);
    expect(vi.mocked(failedRun.end).mock.calls).toEqual([['error']]);
    expect(vi.mocked(retryRun.end).mock.calls).toEqual([['completed']]);
    // 再試行の進捗と統計は新しい実行にだけ送られ、失敗した実行には何も送られない
    expect(failedRun.flushStats).not.toHaveBeenCalled();
    expect(retryRun.flushStats).toHaveBeenCalledTimes(2);
    expect(mockSyncLogs).toHaveBeenCalledTimes(1);
    expect(mockSyncLogs).toHaveBeenCalledWith(
      lockStub,
      expect.anything(),
      retryRun,
    );
  });
});
