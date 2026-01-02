import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, UserFacingError } from '../../../lib/errors';
import { logger } from '../../../lib/logger';
import * as sequelizeClient from '../../../lib/sequelize';
import { LOG_SYNC_MODE, syncLogs } from '../../logSync/service';
import * as settingStore from '../../settingStore';
import * as vrchatWorldJoinLogService from '../../vrchatWorldJoinLog/service';

// モジュールのモック
vi.mock('../../../lib/logger');
vi.mock('../../../lib/sequelize');
vi.mock('../../logSync/service');
vi.mock('../../vrchatWorldJoinLog/service');
vi.mock('../../settingStore');

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
  error: ReturnType<typeof vi.fn>;
};

const mockSequelizeClient = sequelizeClient as unknown as {
  syncRDBClient: ReturnType<typeof vi.fn>;
};

const mockSyncLogs = syncLogs as ReturnType<typeof vi.fn>;

const mockVrchatWorldJoinLogService = vrchatWorldJoinLogService as unknown as {
  findVRChatWorldJoinLogList: ReturnType<typeof vi.fn>;
};

const mockSettingStore = settingStore as unknown as {
  getSettingStore: ReturnType<typeof vi.fn>;
};

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
      eventEmitter: new (await import('node:events')).EventEmitter(),
    });
    return await caller.initializeAppData();
  };
}

describe('settingsController.initializeAppData', () => {
  let initializeAppData:
    | (() => Promise<{ success: boolean; message?: string }>)
    | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();

    // デフォルトのモック設定
    mockLogger.info = vi.fn();
    mockLogger.debug = vi.fn();
    mockLogger.warn = vi.fn();
    mockLogger.error = vi.fn();

    mockSequelizeClient.syncRDBClient = vi.fn().mockResolvedValue(undefined);

    mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList = vi
      .fn()
      .mockResolvedValue([]);

    mockSyncLogs.mockResolvedValue({ isErr: () => false });

    // getSettingStoreのモック
    mockSettingStore.getSettingStore = vi.fn().mockReturnValue({
      getVRChatPhotoDir: vi.fn().mockReturnValue('/path/to/photos'),
    });

    // テスト対象の関数を取得
    initializeAppData = await getInitializeAppDataFunction();
  });

  it('正常な初期化処理が完了する', async () => {
    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
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
      'Step 3: Checking if this is first launch...',
    );
    expect(
      mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList,
    ).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Step 4: Starting log sync...',
    );
    expect(mockSyncLogs).toHaveBeenCalledWith(LOG_SYNC_MODE.FULL);
    expect(mockLogger.info).toHaveBeenCalledWith(
      '=== Application data initialization completed ===',
    );
  });

  it('初回起動時は FULL モードでログ同期が実行される', async () => {
    // 既存ログなし（初回起動）
    mockVrchatWorldJoinLogService.findVRChatWorldJoinLogList.mockResolvedValue(
      [],
    );

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    await initializeAppData();

    expect(mockSyncLogs).toHaveBeenCalledWith(LOG_SYNC_MODE.FULL);
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

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    await initializeAppData();

    expect(mockSyncLogs).toHaveBeenCalledWith(LOG_SYNC_MODE.INCREMENTAL);
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

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    await initializeAppData();

    expect(mockSyncLogs).toHaveBeenCalledWith(LOG_SYNC_MODE.FULL);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Database error detected, treating as first launch:',
      expect.any(Error),
    );
  });

  it('LOG_FILE_DIR_NOT_FOUND エラー時はセットアップが必要なエラーをスローする', async () => {
    // ログ同期でLOG_FILE_DIR_NOT_FOUNDエラー
    mockSyncLogs.mockResolvedValue({
      isErr: () => true,
      error: {
        code: 'LOG_FILE_DIR_NOT_FOUND',
        message: 'Log directory not found',
      },
    });

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');

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
    mockSyncLogs.mockResolvedValue({
      isErr: () => true,
      error: { code: 'LOG_FILES_NOT_FOUND', message: 'No log files found' },
    });

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');

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
    mockSyncLogs.mockResolvedValue({
      isErr: () => true,
      error: { code: 'OTHER_ERROR', message: 'Some other error' },
    });

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    const result = await initializeAppData();

    expect(result).toEqual({ success: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Log sync failed: Some other error. This is normal in development environments without VRChat logs.',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      '=== Application data initialization completed ===',
    );
  });

  it('データベース同期エラー時はエラーをスローする', async () => {
    // データベース同期エラー
    mockSequelizeClient.syncRDBClient.mockRejectedValue(
      new Error('Database sync failed'),
    );

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');

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

    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');

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

  it('重複実行防止が機能する', async () => {
    // 最初の実行
    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    const firstPromise = initializeAppData();

    // 2回目の実行（重複）
    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    const secondResult = await initializeAppData();

    // 2回目は重複として処理される
    expect(secondResult).toEqual({
      success: false,
      message: '初期化処理が既に実行中です',
    });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Initialization already in progress, skipping duplicate request',
    );

    // 最初の実行は正常に完了
    const firstResult = await firstPromise;
    expect(firstResult).toEqual({ success: true });
  });

  it('正常完了後はフラグがリセットされる', async () => {
    // 最初の実行を完了
    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    await initializeAppData();

    // 2回目の実行は正常に動作する（重複扱いにならない）
    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    const result = await initializeAppData();
    expect(result).toEqual({ success: true });
  });

  it('エラー発生後もフラグがリセットされる', async () => {
    // エラーを発生させる
    mockSequelizeClient.syncRDBClient.mockRejectedValue(
      new Error('Test error'),
    );

    try {
      if (!initializeAppData)
        throw new Error('initializeAppData not initialized');
      await initializeAppData();
    } catch {
      // エラーは期待される
    }

    // エラー後に再実行可能
    mockSequelizeClient.syncRDBClient.mockResolvedValue(undefined);
    if (!initializeAppData)
      throw new Error('initializeAppData not initialized');
    const result = await initializeAppData();
    expect(result).toEqual({ success: true });
  });
});
