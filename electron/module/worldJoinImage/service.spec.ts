import * as neverthrow from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('../imageGenerator/service');
vi.mock('../vrchatApi/service');
vi.mock('../vrchatWorldJoinLog/service');
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../initProgress/emitter', () => ({
  emitProgress: vi.fn(),
  emitStageStart: vi.fn(),
}));
vi.mock('ofetch', () => ({
  ofetch: vi.fn(),
}));

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { ofetch } from 'ofetch';
import { generateWorldJoinImage } from '../imageGenerator/service';
import { getVrcWorldInfoByWorldId } from '../vrchatApi/service';
import { findVRChatWorldJoinLogList } from '../vrchatWorldJoinLog/service';
import {
  _resetGeneratingFlag,
  generateMissingWorldJoinImages,
} from './service';

describe('generateMissingWorldJoinImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetGeneratingFlag();
  });

  const makeJoinLog = (worldId: string) => ({
    id: '1',
    worldId,
    worldName: 'Test World',
    worldInstanceId: 'i1',
    joinDateTime: new Date('2024-01-15T12:00:00'),
    createdAt: new Date(),
    updatedAt: null,
  });

  it('should return 0 generated when all images exist', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_test'),
    ]);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.generated).toBe(0);
      expect(result.value.skipped).toBe(1);
    }
  });

  it('should return 0 when photoDirPath is empty', async () => {
    const result = await generateMissingWorldJoinImages({ photoDirPath: '' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.generated).toBe(0);
    }
  });

  it('should return 0 when no joins exist', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([]);

    const result = await generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.generated).toBe(0);
      expect(result.value.skipped).toBe(0);
    }
  });

  it('should generate image for missing join', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_test'),
    ]);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(getVrcWorldInfoByWorldId).mockResolvedValue(
      neverthrow.ok({
        id: 'wrld_test',
        name: 'Test World',
        imageUrl: 'https://example.com/image.png',
        description: '',
        authorId: '',
        authorName: '',
        releaseStatus: 'public',
        featured: false,
        capacity: 20,
        recommendedCapacity: 20,
        thumbnailImageUrl: '',
        version: 1,
        organization: 'vrchat',
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
      }),
    );
    vi.mocked(ofetch).mockResolvedValue(new ArrayBuffer(8));
    vi.mocked(generateWorldJoinImage).mockResolvedValue(
      neverthrow.ok(Buffer.from('fake-jpeg')),
    );
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const result = await generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.generated).toBe(1);
      expect(result.value.errors).toBe(0);
    }
    expect(generateWorldJoinImage).toHaveBeenCalledOnce();
    expect(fsPromises.writeFile).toHaveBeenCalledOnce();
  });

  it('should count error when world API fails', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_test'),
    ]);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(getVrcWorldInfoByWorldId).mockResolvedValue(
      neverthrow.err({
        type: 'WORLD_NOT_FOUND' as const,
        worldId: 'wrld_test',
      }),
    );

    const result = await generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.generated).toBe(0);
      expect(result.value.errors).toBe(1);
    }
  });

  it('should count error when image download fails', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_test'),
    ]);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(getVrcWorldInfoByWorldId).mockResolvedValue(
      neverthrow.ok({
        id: 'wrld_test',
        name: 'Test World',
        imageUrl: 'https://example.com/image.png',
        description: '',
        authorId: '',
        authorName: '',
        releaseStatus: 'public',
        featured: false,
        capacity: 20,
        recommendedCapacity: 20,
        thumbnailImageUrl: '',
        version: 1,
        organization: 'vrchat',
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
      }),
    );
    vi.mocked(ofetch).mockRejectedValue(new Error('Network error'));

    const result = await generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.generated).toBe(0);
      expect(result.value.errors).toBe(1);
    }
  });

  it('should skip when already generating (mutex)', async () => {
    // Set up a slow first call
    vi.mocked(findVRChatWorldJoinLogList).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([]), 50);
        }),
    );

    // Start first call (will be pending)
    const promise1 = generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });
    // Second call should skip immediately due to mutex
    const result2 = await generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });
    await promise1;

    expect(result2.isOk()).toBe(true);
    if (result2.isOk()) {
      expect(result2.value.generated).toBe(0);
      expect(result2.value.skipped).toBe(0);
      expect(result2.value.errors).toBe(0);
    }
  });

  it('should reset mutex after error', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockRejectedValueOnce(
      new Error('DB error'),
    );

    // First call throws
    await expect(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    ).rejects.toThrow('DB error');

    // Mutex should be reset, second call should work
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([]);
    const result = await generateMissingWorldJoinImages({
      photoDirPath: '/photos',
    });

    expect(result.isOk()).toBe(true);
  });
});
