import { Cause, Effect, Exit, Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getData } from '../../lib/getData';
import { VRChatWorldIdSchema } from '../vrchatLog/model';
import * as vrchatApiService from './service';

vi.mock('../../lib/getData', () => ({
  getData: vi.fn(),
}));

/**
 * UserSchema の必須フィールドを満たす最小ユーザー。
 * displayName は検索語と一致させて resolve 経路を通すために上書きする。
 */
const buildMockUser = (displayName: string) => ({
  currentAvatarImageUrl: '',
  currentAvatarTags: [] as string[],
  currentAvatarThumbnailImageUrl: '',
  developerType: 'none',
  displayName,
  id: 'usr_00000000-0000-0000-0000-000000000000',
  isFriend: false,
  last_platform: 'standalonewindows',
  status: 'active',
  tags: [] as string[],
});

describe('vrchatApi/service', () => {
  it('should be defined', () => {
    expect(vrchatApiService).toBeDefined();
  });
  describe('getVrcWorldInfoByWorldId', () => {
    it('should be defined', () => {
      expect(vrchatApiService.getVrcWorldInfoByWorldId).toBeDefined();
    });
    it('return world name', async () => {
      // Arrange
      const worldId = 'wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f';
      const mockWorldInfo = {
        id: worldId,
        name: 'Mock World',
        description: '',
        authorId: 'usr_123',
        authorName: 'Author',
        releaseStatus: 'public',
        featured: false,
        capacity: 0,
        recommendedCapacity: 0,
        imageUrl: '',
        thumbnailImageUrl: '',
        version: 1,
        organization: '',
        previewYoutubeId: null,
        udonProducts: [],
        favorites: 0,
        visits: 0,
        popularity: 0,
        heat: 0,
        publicationDate: '',
        labsPublicationDate: '',
        instances: [],
        publicOccupants: 0,
        privateOccupants: 0,
        occupants: 0,
        unityPackages: [],
        tags: [],
        created_at: '',
        updated_at: '',
      };
      vi.mocked(getData).mockReturnValueOnce(Effect.succeed(mockWorldInfo));
      // Act
      const value = await Effect.runPromise(
        vrchatApiService.getVrcWorldInfoByWorldId(
          VRChatWorldIdSchema.parse(worldId),
        ),
      );
      // Assert
      expect(value).toBeDefined();
      expect(value.id).toBe(worldId);
    });
  });

  describe('getVrcUserInfoByUserName のキュー堅牢性', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('1件目が HTTP エラーで失敗しても後続リクエストがデッドロックせず処理される', async () => {
      // Arrange: 1件目は 429 で失敗、2件目は正常応答
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, statusText: 'Too Many Requests' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [buildMockUser('target')],
        });
      vi.stubGlobal('fetch', fetchMock);

      // Act: 2件同時投入（2件目は1件目処理中のためキューに積まれる）
      const first = Effect.runPromiseExit(
        vrchatApiService.getVrcUserInfoByUserName('failing'),
      );
      const second = Effect.runPromiseExit(
        vrchatApiService.getVrcUserInfoByUserName('target'),
      );

      // キュー内のリクエスト間 1 秒 delay を消化させる
      await vi.advanceTimersByTimeAsync(3000);
      const [firstExit, secondExit] = await Promise.all([first, second]);

      // Assert: 1件目は失敗するが、2件目は処理され成功する（キューが解放されている）
      expect(Exit.isFailure(firstExit)).toBe(true);
      expect(Exit.isSuccess(secondExit)).toBe(true);
      if (Exit.isSuccess(secondExit)) {
        expect(secondExit.value.displayName).toBe('target');
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('存在しないユーザーは USER_NOT_FOUND を返し、後続リクエストも継続処理される', async () => {
      // Arrange: 1件目は空配列（USER_NOT_FOUND）、2件目は正常応答
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [buildMockUser('target')],
        });
      vi.stubGlobal('fetch', fetchMock);

      // Act
      const first = Effect.runPromiseExit(
        vrchatApiService.getVrcUserInfoByUserName('missing'),
      );
      const second = Effect.runPromiseExit(
        vrchatApiService.getVrcUserInfoByUserName('target'),
      );

      await vi.advanceTimersByTimeAsync(3000);
      const [firstExit, secondExit] = await Promise.all([first, second]);

      // Assert: 1件目は USER_NOT_FOUND、2件目は成功
      expect(Exit.isFailure(firstExit)).toBe(true);
      if (Exit.isFailure(firstExit)) {
        const failOpt = Cause.failureOption(firstExit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value).toBe('USER_NOT_FOUND');
        }
      }
      expect(Exit.isSuccess(secondExit)).toBe(true);
    });
  });
});
