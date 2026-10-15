import { parseISO } from 'date-fns';
import { Effect } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as client from '../../lib/sequelize';
import { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { createVRChatWorldJoinLogFromPhoto } from '../vrchatWorldJoinLogFromPhoto/service';
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
      const results = await Effect.runPromise(
        searchSessionsByPlayerName('TestPlayer'),
      );

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
      const results = await Effect.runPromise(
        searchSessionsByPlayerName('casesensitive'),
      );
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
      const results = await Effect.runPromise(
        searchSessionsByPlayerName('DuplicateTest'),
      );

      // 1つのセッションのみ返される
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(worldJoin.joinDateTime);
    });

    it('写真由来の参加ログで区切られたセッションの開始日時を返す', async () => {
      // 通常ログ: 10:00 World A。写真由来ログ: 10:30 World B。
      // 10:45 のプレイヤー参加は、ギャラリーと同じく写真由来ログのセッションに属する
      await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_normal',
        worldName: 'Normal World',
        worldInstanceId: '33333',
        joinDateTime: parseISO('2024-01-05T10:00:00'),
      });
      const photoJoinTime = parseISO('2024-01-05T10:30:00');
      await createVRChatWorldJoinLogFromPhoto([
        { worldId: 'wrld_photo', joinDate: photoJoinTime },
      ]);

      await VRChatPlayerJoinLogModel.create({
        playerName: 'PhotoSessionPlayer',
        joinDateTime: parseISO('2024-01-05T10:45:00'),
      });

      const results = await Effect.runPromise(
        searchSessionsByPlayerName('PhotoSessionPlayer'),
      );

      expect(results).toEqual([photoJoinTime]);
    });

    it('次の参加ちょうどに入ったプレイヤーは次のセッションに属する', async () => {
      await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_before',
        worldName: 'Before World',
        worldInstanceId: '44444',
        joinDateTime: parseISO('2024-01-06T10:00:00'),
      });
      const nextJoin = await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_after',
        worldName: 'After World',
        worldInstanceId: '55555',
        joinDateTime: parseISO('2024-01-06T11:00:00'),
      });
      await VRChatPlayerJoinLogModel.create({
        playerName: 'BoundaryPlayer',
        joinDateTime: parseISO('2024-01-06T11:00:00'),
      });

      const results = await Effect.runPromise(
        searchSessionsByPlayerName('BoundaryPlayer'),
      );

      expect(results).toEqual([nextJoin.joinDateTime]);
    });

    it('プレイヤー参加より前の履歴が長くても、直前の参加ログをセッションの開始として返す', async () => {
      await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_old1',
        worldName: 'Old World 1',
        worldInstanceId: '10001',
        joinDateTime: parseISO('2024-02-01T08:00:00'),
      });
      await VRChatWorldJoinLogModel.create({
        worldId: 'wrld_old2',
        worldName: 'Old World 2',
        worldInstanceId: '10002',
        joinDateTime: parseISO('2024-02-01T09:00:00'),
      });
      // 通常ログより新しい写真由来の参加ログが、プレイヤー参加の直前の区切りになる
      await createVRChatWorldJoinLogFromPhoto([
        {
          worldId: 'wrld_photo-before',
          joinDate: parseISO('2024-02-01T09:30:00'),
        },
      ]);
      await VRChatPlayerJoinLogModel.create({
        playerName: 'LateJoiner',
        joinDateTime: parseISO('2024-02-01T10:00:00'),
      });

      const results = await Effect.runPromise(
        searchSessionsByPlayerName('LateJoiner'),
      );

      expect(results).toStrictEqual([parseISO('2024-02-01T09:30:00')]);
    });

    it('該当するプレイヤーが存在しない場合、空の配列を返す', async () => {
      const results = await Effect.runPromise(
        searchSessionsByPlayerName('NonExistentPlayer'),
      );
      expect(results).toEqual([]);
    });

    it('プレイヤーは存在するがワールド参加ログがない場合、空の配列を返す', async () => {
      await VRChatPlayerJoinLogModel.create({
        playerName: 'PlayerWithoutWorld',
        joinDateTime: parseISO('2024-01-04T10:00:00'),
      });

      const results = await Effect.runPromise(
        searchSessionsByPlayerName('PlayerWithoutWorld'),
      );
      expect(results).toEqual([]);
    });
  });
});
