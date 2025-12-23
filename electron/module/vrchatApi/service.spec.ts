import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { getData } from '../../lib/getData';
import { VRChatWorldIdSchema } from '../vrchatLog/model';
import * as vrchatApiService from './service';

vi.mock('../../lib/getData', () => ({
  getData: vi.fn(),
}));

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
      vi.mocked(getData).mockResolvedValueOnce(ok(mockWorldInfo));
      // Act
      const result = await vrchatApiService.getVrcWorldInfoByWorldId(
        VRChatWorldIdSchema.parse(worldId),
      );
      // Assert
      expect(result).toBeDefined();
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.id).toBe(worldId);
    });
  });
});
