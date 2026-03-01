import { parseISO } from 'date-fns';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as client from '../../lib/sequelize';
import { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { searchSessionsByPlayerName } from './service';

describe('searchSessionsByPlayerName integration test', () => {
  beforeAll(async () => {
    await client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  describe('searchSessionsByPlayerName', () => {
    it('プレイヤー名で部分一致検索ができる', async () => {
      // テストデータの準備
      const worldJoin1 = await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_test1',
        worldName: 'Test World 1',
        worldInstanceId: '12345',
        joinDateTime: parseISO('2024-01-01T10:00:00'),
      });

      const worldJoin2 = await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_test2',
        worldName: 'Test World 2',
        worldInstanceId: '67890',
        joinDateTime: parseISO('2024-01-01T12:00:00'),
      });

      await VRChatPlayerJoinLogModel.create({
        playerName: 'TestPlayer123',
        joinDateTime: parseISO('2024-01-01T10:30:00'),
      });

      await VRChatPlayerJoinLogModel.create({
        playerName: 'AnotherPlayer',
        joinDateTime: parseISO('2024-01-01T10:45:00'),
      });

      await VRChatPlayerJoinLogModel.create({
        playerName: 'TestPlayer456',
        joinDateTime: parseISO('2024-01-01T12:30:00'),
      });

      // "TestPlayer"で検索
      const result = await searchSessionsByPlayerName('TestPlayer');
      const results = result._unsafeUnwrap();

      // 2つのセッションが見つかるはず
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(worldJoin2.joinDateTime);
      expect(results[1]).toEqual(worldJoin1.joinDateTime);
    });

    it('大文字小文字を区別しない検索ができる', async () => {
      await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_test3',
        worldName: 'Test World 3',
        worldInstanceId: '11111',
        joinDateTime: parseISO('2024-01-02T10:00:00'),
      });

      await VRChatPlayerJoinLogModel.create({
        playerName: 'CaseSensitivePlayer',
        joinDateTime: parseISO('2024-01-02T10:15:00'),
      });

      // 小文字で検索しても見つかる
      const result = await searchSessionsByPlayerName('casesensitive');
      const results = result._unsafeUnwrap();
      expect(results).toHaveLength(1);
    });

    it('同じセッションに複数のプレイヤーがいる場合、重複なく1つのセッションを返す', async () => {
      const worldJoin = await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_test4',
        worldName: 'Test World 4',
        worldInstanceId: '22222',
        joinDateTime: parseISO('2024-01-03T10:00:00'),
      });

      await VRChatPlayerJoinLogModel.create({
        playerName: 'DuplicateTestPlayer1',
        joinDateTime: parseISO('2024-01-03T10:15:00'),
      });

      await VRChatPlayerJoinLogModel.create({
        playerName: 'DuplicateTestPlayer2',
        joinDateTime: parseISO('2024-01-03T10:30:00'),
      });

      // "DuplicateTest"で検索
      const result = await searchSessionsByPlayerName('DuplicateTest');
      const results = result._unsafeUnwrap();

      // 1つのセッションのみ返される
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(worldJoin.joinDateTime);
    });

    it('該当するプレイヤーが存在しない場合、空の配列を返す', async () => {
      const result = await searchSessionsByPlayerName('NonExistentPlayer');
      const results = result._unsafeUnwrap();
      expect(results).toEqual([]);
    });

    it('プレイヤーは存在するがワールド参加ログがない場合、空の配列を返す', async () => {
      await VRChatPlayerJoinLogModel.create({
        playerName: 'PlayerWithoutWorld',
        joinDateTime: parseISO('2024-01-04T10:00:00'),
      });

      const result = await searchSessionsByPlayerName('PlayerWithoutWorld');
      const results = result._unsafeUnwrap();
      expect(results).toEqual([]);
    });
  });
});
