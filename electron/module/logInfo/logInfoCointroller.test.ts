import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCaches } from '../../lib/queryCache';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
// import { VRChatPlayerNameSchema } from '../vrchatLog/model';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { findVRChatWorldJoinLogFromPhotoList } from '../vrchatWorldJoinLogFromPhoto/service';
import { getPlayerJoinListInSameWorld } from './logInfoCointroller';

// playerJoinLogServiceとworldJoinLogServiceのモック
vi.mock('../VRChatPlayerJoinLogModel/playerJoinLog.service');
vi.mock('../vrchatWorldJoinLog/service');
vi.mock('../vrchatWorldJoinLogFromPhoto/service');

describe('getPlayerJoinListInSameWorld', () => {
  // テスト前にモックとキャッシュをリセット
  beforeEach(() => {
    vi.resetAllMocks();
    clearAllCaches(); // キャッシュをクリア
    // 統合処理に必要なモックの共通設定
    vi.mocked(worldJoinLogService.findVRChatWorldJoinLogList).mockResolvedValue(
      [],
    );
    vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([]);
    vi.mocked(findVRChatWorldJoinLogFromPhotoList).mockResolvedValue([]);
  });

  it('正常系: プレイヤー参加ログが取得できる場合', async () => {
    // モックデータ
    const mockDateTime = new Date('2023-01-01T12:00:00Z');
    const mockRecentWorldJoin = {
      id: 'world1',
      worldId: 'wrld_123',
      worldName: 'Test World',
      worldInstanceId: 'instance1',
      joinDateTime: new Date('2023-01-01T12:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockNextWorldJoin = {
      id: 'world2',
      worldId: 'wrld_456',
      worldName: 'Next World',
      worldInstanceId: 'instance2',
      joinDateTime: new Date('2023-01-01T13:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockPlayerJoinLogList = [
      {
        id: '1',
        playerId: 'player1',
        playerName: 'Player 1',
        joinDateTime: new Date('2023-01-01T12:10:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        playerId: 'player2',
        playerName: 'Player 2',
        joinDateTime: new Date('2023-01-01T12:30:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([
      mockNextWorldJoin,
      mockRecentWorldJoin,
    ]);

    vi.mocked(
      playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
    ).mockReturnValue(Effect.succeed(mockPlayerJoinLogList));

    const result = await Effect.runPromise(
      getPlayerJoinListInSameWorld(mockDateTime),
    );

    expect(result).not.toBeNull();
    expect(result).toEqual(mockPlayerJoinLogList);

    expect(
      playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
    ).toHaveBeenCalledWith({
      startJoinDateTime: mockNextWorldJoin.joinDateTime,
      endJoinDateTime: mockRecentWorldJoin.joinDateTime,
    });
  });

  it('異常系: 直近のワールド参加ログが見つからない場合', async () => {
    const mockDateTime = new Date('2023-01-01T12:00:00Z');

    vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([]);

    const result = await Effect.runPromise(
      getPlayerJoinListInSameWorld(mockDateTime),
    );

    expect(result).toBeNull();
  });

  it('異常系: プレイヤー参加ログの取得に失敗した場合 (DATABASE_ERROR)', async () => {
    const mockDateTime = new Date('2023-01-01T12:00:00Z');
    const mockRecentWorldJoin = {
      id: 'world1',
      worldId: 'wrld_123',
      worldName: 'Test World',
      worldInstanceId: 'instance1',
      joinDateTime: new Date('2023-01-01T11:30:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { PlayerJoinLogDatabaseError } = await import(
      '../VRChatPlayerJoinLogModel/errors'
    );
    const mockError = new PlayerJoinLogDatabaseError({
      message: 'データベースエラー',
    });

    vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([
      mockRecentWorldJoin,
    ]);

    vi.mocked(
      playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
    ).mockReturnValue(Effect.fail(mockError));

    // Effect.runPromise inside the controller will throw on failure
    // The controller catches this and returns null
    const result = await Effect.runPromise(
      getPlayerJoinListInSameWorld(mockDateTime),
    );

    expect(result).toBeNull();
  });

  it('異常系: プレイヤー参加ログが空の場合', async () => {
    const mockDateTime = new Date('2023-01-01T12:00:00Z');
    const mockRecentWorldJoin = {
      id: 'world1',
      worldId: 'wrld_123',
      worldName: 'Test World',
      worldInstanceId: 'instance1',
      joinDateTime: new Date('2023-01-01T11:30:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([
      mockRecentWorldJoin,
    ]);

    vi.mocked(
      playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
    ).mockReturnValue(Effect.succeed([]));

    const result = await Effect.runPromise(
      getPlayerJoinListInSameWorld(mockDateTime),
    );

    // Empty player join log list returns null (controller returns null when no players found)
    expect(result).toBeNull();
  });

  it('異常系: 次のワールド参加ログが存在しない場合', async () => {
    const mockDateTime = new Date('2023-01-01T12:00:00Z');
    const mockRecentWorldJoin = {
      id: 'world1',
      worldId: 'wrld_123',
      worldName: 'Test World',
      worldInstanceId: 'instance1',
      joinDateTime: new Date('2023-01-01T11:30:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockPlayerJoinLogList = [
      {
        id: '1',
        playerId: 'player1',
        playerName: 'Player 1',
        joinDateTime: new Date('2023-01-01T11:45:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([
      mockRecentWorldJoin,
    ]);

    vi.mocked(
      playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
    ).mockReturnValue(Effect.succeed(mockPlayerJoinLogList));

    const result = await Effect.runPromise(
      getPlayerJoinListInSameWorld(mockDateTime),
    );

    expect(result).toEqual(mockPlayerJoinLogList);

    expect(
      playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
    ).toHaveBeenCalledWith({
      startJoinDateTime: mockRecentWorldJoin.joinDateTime,
      endJoinDateTime: mockRecentWorldJoin.joinDateTime,
    });
  });

  // セッション内全プレイヤー取得のテストケース
  describe('セッション内全プレイヤー取得のテストケース', () => {
    it('セッション期間内にjoinした全プレイヤーが取得される（leaveしたプレイヤーも含む）', async () => {
      const mockDateTime = new Date('2023-01-01T12:00:00Z');

      const mockRecentLog = {
        id: 'recent1',
        worldId: 'wrld_123',
        worldName: 'Test World',
        worldInstanceId: 'instance1',
        joinDateTime: new Date('2023-01-01T11:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockNextLog = {
        id: 'next1',
        worldId: 'wrld_456',
        worldName: 'Next World',
        worldInstanceId: 'instance2',
        joinDateTime: new Date('2023-01-01T13:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPlayersInSession = [
        {
          id: '1',
          playerId: 'player1',
          playerName: 'Early Joiner',
          joinDateTime: new Date('2023-01-01T11:15:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          playerId: 'player2',
          playerName: 'Mid Joiner',
          joinDateTime: new Date('2023-01-01T12:00:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '3',
          playerId: 'player3',
          playerName: 'Late Joiner',
          joinDateTime: new Date('2023-01-01T12:45:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '4',
          playerId: null,
          playerName: 'Guest Player',
          joinDateTime: new Date('2023-01-01T11:30:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([
        mockRecentLog,
        mockNextLog,
      ]);

      vi.mocked(
        playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
      ).mockReturnValue(Effect.succeed(mockPlayersInSession));

      const result = await Effect.runPromise(
        getPlayerJoinListInSameWorld(mockDateTime),
      );

      expect(result).not.toBeNull();
      expect(result).toEqual(mockPlayersInSession);
      expect(result).toHaveLength(4);

      const playerNames = result?.map((p) => p.playerName);
      expect(playerNames).toContain('Early Joiner');
      expect(playerNames).toContain('Mid Joiner');
      expect(playerNames).toContain('Late Joiner');
      expect(playerNames).toContain('Guest Player');

      expect(
        playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
      ).toHaveBeenCalledWith({
        startJoinDateTime: mockNextLog.joinDateTime,
        endJoinDateTime: mockRecentLog.joinDateTime,
      });
    });

    it('セッション期間外のプレイヤーは除外される', async () => {
      const mockDateTime = new Date('2023-01-01T12:00:00Z');

      const mockRecentLog = {
        id: 'recent1',
        worldId: 'wrld_123',
        worldName: 'Test World',
        worldInstanceId: 'instance1',
        joinDateTime: new Date('2023-01-01T11:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockNextLog = {
        id: 'next1',
        worldId: 'wrld_456',
        worldName: 'Next World',
        worldInstanceId: 'instance2',
        joinDateTime: new Date('2023-01-01T13:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPlayersInSession = [
        {
          id: '1',
          playerId: 'player1',
          playerName: 'Session Player',
          joinDateTime: new Date('2023-01-01T12:00:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([
        mockRecentLog,
        mockNextLog,
      ]);

      vi.mocked(
        playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
      ).mockReturnValue(Effect.succeed(mockPlayersInSession));

      const result = await Effect.runPromise(
        getPlayerJoinListInSameWorld(mockDateTime),
      );

      expect(result).toHaveLength(1);
      expect(result?.[0].playerName).toBe('Session Player');

      expect(
        playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
      ).toHaveBeenCalledWith({
        startJoinDateTime: mockNextLog.joinDateTime,
        endJoinDateTime: mockRecentLog.joinDateTime,
      });
    });

    it('開いているセッション（終了時刻なし）でもプレイヤー取得ができる', async () => {
      const mockDateTime = new Date('2023-01-01T12:00:00Z');

      const mockRecentLog = {
        id: 'current',
        worldId: 'wrld_123',
        worldName: 'Current World',
        worldInstanceId: 'instance1',
        joinDateTime: new Date('2023-01-01T11:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPlayersInCurrentSession = [
        {
          id: '1',
          playerId: 'player1',
          playerName: 'Current Player',
          joinDateTime: new Date('2023-01-01T11:30:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue([
        mockRecentLog,
      ]);

      vi.mocked(
        playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
      ).mockReturnValue(Effect.succeed(mockPlayersInCurrentSession));

      const result = await Effect.runPromise(
        getPlayerJoinListInSameWorld(mockDateTime),
      );

      expect(result).toEqual(mockPlayersInCurrentSession);

      expect(
        playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
      ).toHaveBeenCalledWith({
        startJoinDateTime: mockRecentLog.joinDateTime,
        endJoinDateTime: mockRecentLog.joinDateTime,
      });
    });
  });

  // 統合処理のテストケース（PhotoAsLogと通常ログの混在）
  describe('統合処理のテストケース', () => {
    it('統合ログから正しくプレイヤーリストが取得される', async () => {
      const mockDateTime = new Date('2023-01-01T12:00:00Z');

      const mockMergedLogs = [
        {
          id: 'normal1',
          worldId: 'wrld_123',
          worldName: 'Test World',
          worldInstanceId: 'instance1',
          joinDateTime: new Date('2023-01-01T11:30:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockPlayerJoinLogs = [
        {
          id: '1',
          playerId: 'player1',
          playerName: 'Player 1',
          joinDateTime: new Date('2023-01-01T11:45:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(
        worldJoinLogService.findVRChatWorldJoinLogList,
      ).mockResolvedValue([]);
      vi.mocked(worldJoinLogService.mergeVRChatWorldJoinLogs).mockReturnValue(
        mockMergedLogs,
      );

      vi.mocked(findVRChatWorldJoinLogFromPhotoList).mockResolvedValue([]);

      vi.mocked(
        playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime,
      ).mockReturnValue(Effect.succeed(mockPlayerJoinLogs));

      const result = await Effect.runPromise(
        getPlayerJoinListInSameWorld(mockDateTime),
      );

      expect(result).toEqual(mockPlayerJoinLogs);

      expect(worldJoinLogService.mergeVRChatWorldJoinLogs).toHaveBeenCalled();
    });
  });
});
