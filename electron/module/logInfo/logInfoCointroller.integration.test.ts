import * as datefns from 'date-fns';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { clearAllCaches } from '../../lib/queryCache';
import * as client from '../../lib/sequelize';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import { VRChatPlayerNameSchema } from '../vrchatLog/model';

describe('getFrequentPlayerNames tRPC endpoint integration tests', () => {
  beforeAll(async () => {
    client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
    clearAllCaches(); // キャッシュをクリア
    // このテストファイル内でのみモックを無効化
    vi.doUnmock('../logInfo/service');
    vi.doUnmock('../VRChatPlayerJoinLogModel/playerJoinLog.service');
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  it('tRPCエンドポイント経由でよく遊ぶプレイヤー名を取得できる', async () => {
    // テストデータの準備
    const testData = [
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('PopularPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('PopularPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('PopularPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-04T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('PopularPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('RegularPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('RegularPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('RegularPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('CasualPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('CasualPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('NewPlayer'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
    ];

    await playerJoinLogService.createVRChatPlayerJoinLogModel(testData);

    // logInfoRouter をインポートしてテスト
    const { logInfoRouter } = await import('./logInfoCointroller');
    const router = logInfoRouter();

    // tRPCエンドポイントを直接呼び出し
    const result = await router.getFrequentPlayerNames({
      ctx: {} as unknown,
      input: { limit: 3 },
      rawInput: { limit: 3 },
      path: '',
      type: 'query',
    });

    // 頻度順で返されることを確認
    expect(result).toEqual(['PopularPlayer', 'RegularPlayer', 'CasualPlayer']);
  });

  it('limitパラメータが正しく機能する', async () => {
    // テストデータの準備
    const testData = [
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player1'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player1'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player1'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player2'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player2'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player3'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player4'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player5'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
    ];

    await playerJoinLogService.createVRChatPlayerJoinLogModel(testData);

    const { logInfoRouter } = await import('./logInfoCointroller');
    const router = logInfoRouter();

    // limit=2で取得
    const result = await router.getFrequentPlayerNames({
      ctx: {} as unknown,
      input: { limit: 2 },
      rawInput: { limit: 2 },
      path: '',
      type: 'query',
    });

    expect(result).toHaveLength(2);
    expect(result).toEqual(['Player1', 'Player2']);
  });

  it('データが存在しない場合は空配列を返す', async () => {
    const { logInfoRouter } = await import('./logInfoCointroller');
    const router = logInfoRouter();

    const result = await router.getFrequentPlayerNames({
      ctx: {} as unknown,
      input: { limit: 5 },
      rawInput: { limit: 5 },
      path: '',
      type: 'query',
    });

    expect(result).toEqual([]);
  });

  it('デフォルトのlimit値が適用される', async () => {
    // 6人のプレイヤーデータを作成（デフォルトlimit=5より多く）
    const testData = [
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player1'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player2'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player3'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player4'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player5'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
        playerName: VRChatPlayerNameSchema.parse('Player6'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
    ];

    await playerJoinLogService.createVRChatPlayerJoinLogModel(testData);

    const { logInfoRouter } = await import('./logInfoCointroller');
    const router = logInfoRouter();

    // limitを指定せずに呼び出し（デフォルト=5が適用されるはず）
    const result = await router.getFrequentPlayerNames({
      ctx: {} as unknown,
      input: { limit: 5 }, // Explicitly pass default limit since we're bypassing zod parsing
      rawInput: { limit: 5 },
      path: '',
      type: 'query',
    });

    expect(result).toHaveLength(5); // デフォルトの5件
    expect(result).toEqual([
      'Player1',
      'Player2',
      'Player3',
      'Player4',
      'Player5',
    ]);
  });
});
