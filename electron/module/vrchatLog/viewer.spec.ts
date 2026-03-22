import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { getData } from '../../lib/getData';
import type { VRChatWorldInfoFromApi } from '../vrchatApi/service';

vi.mock('../../lib/getData', () => ({
  getData: vi.fn(),
}));

describe('viewer_api', () => {
  it('ワールド情報を取得する', async () => {
    const worldId = 'wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f';
    // api で world 情報を取得する
    const reqUrl = `https://api.vrchat.cloud/api/1/worlds/${worldId}`;
    const mockWorldInfo: VRChatWorldInfoFromApi = {
      id: worldId,
      name: 'Mock World',
      description: '',
      authorId: 'usr',
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
    const worldInfo = await Effect.runPromise(
      getData<VRChatWorldInfoFromApi>(reqUrl),
    );
    expect(worldInfo).toBeDefined();
    expect(worldInfo.id).toBe(worldId);
    expect(typeof worldInfo.name).toBe('string');
  }, 2000);
});
