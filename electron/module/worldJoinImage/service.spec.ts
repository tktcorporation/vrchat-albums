import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises');
vi.mock('../imageGenerator/service');
vi.mock('../vrchatApi/service');
vi.mock('../vrchatWorldJoinLog/service');
vi.mock('../../lib/wrappedExifTool');
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

import * as fsPromises from 'node:fs/promises';

import { ofetch } from 'ofetch';

import { setExifToBuffer } from '../../lib/wrappedExifTool';
import { generateWorldJoinImage } from '../imageGenerator/service';
import { VRChatApiWorldNotFound } from '../vrchatApi/errors';
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
    // setExifToBuffer のデフォルトモック: 入力バッファをそのまま返す
    vi.mocked(setExifToBuffer).mockImplementation((buffer) =>
      Effect.succeed(buffer),
    );
  });

  const makeWorldInfo = () => ({
    id: 'wrld_12345678-1234-1234-1234-123456789abc',
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
      makeJoinLog('wrld_12345678-1234-1234-1234-123456789abc'),
    ]);
    vi.mocked(fsPromises.access).mockResolvedValue();

    const result = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should return 0 when photoDirPath is empty', async () => {
    const result = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '' }),
    );

    expect(result.generated).toBe(0);
  });

  it('should return 0 when no joins exist', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([]);

    const result = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('should generate image for missing join', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_12345678-1234-1234-1234-123456789abc'),
    ]);
    vi.mocked(fsPromises.access).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    vi.mocked(getVrcWorldInfoByWorldId).mockReturnValue(
      Effect.succeed(makeWorldInfo()),
    );
    vi.mocked(ofetch).mockResolvedValue(new ArrayBuffer(8));
    vi.mocked(generateWorldJoinImage).mockReturnValue(
      Effect.succeed(Buffer.from('fake-jpeg')),
    );
    vi.mocked(fsPromises.mkdir).mockResolvedValue();
    vi.mocked(fsPromises.writeFile).mockResolvedValue();

    const result = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );

    expect(result.generated).toBe(1);
    expect(result.errors).toBe(0);

    // Verify generateWorldJoinImage was called with correct arguments
    expect(generateWorldJoinImage).toHaveBeenCalledTimes(1);
    const genCall = vi.mocked(generateWorldJoinImage).mock.calls[0][0];
    expect(genCall.worldName).toBe('Test World');
    expect(genCall.imageBase64).toBe(
      Buffer.from(new ArrayBuffer(8)).toString('base64'),
    );
    expect(genCall.joinDateTime).toEqual(new Date('2024-01-15T12:00:00'));

    // Verify setExifToBuffer was called with correct EXIF metadata
    expect(setExifToBuffer).toHaveBeenCalledTimes(1);
    const exifCall = vi.mocked(setExifToBuffer).mock.calls[0];
    expect(exifCall[0]).toEqual(Buffer.from('fake-jpeg'));
    expect(exifCall[1].description).toBe('Test World');
    expect(exifCall[1].dateTimeOriginal).toMatch(/^2024:01:15 \d{2}:00:00$/);
    expect(exifCall[1].timezoneOffset).toMatch(/^[+-]\d{2}:\d{2}$/);

    // Verify mkdir was called with { recursive: true }
    expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsPromises.mkdir).mock.calls[0][1]).toEqual({
      recursive: true,
    });

    // Verify writeFile was called with path containing YYYY-MM directory and proper filename
    expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
    const writePath = vi.mocked(fsPromises.writeFile).mock
      .calls[0][0] as string;
    expect(writePath).toMatch(/\/photos\/2024-01\//);
    expect(writePath).toMatch(
      /VRChat_2024-01-15_12-00-00\.000_wrld_12345678-1234-1234-1234-123456789abc\.jpeg$/,
    );
  });

  it('should count error when world API fails', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_12345678-1234-1234-1234-123456789abc'),
    ]);
    vi.mocked(fsPromises.access).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    vi.mocked(getVrcWorldInfoByWorldId).mockReturnValue(
      Effect.fail(
        new VRChatApiWorldNotFound({
          worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
        }),
      ),
    );

    const result = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );

    expect(result.generated).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('should count error when image download fails with FetchError', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_12345678-1234-1234-1234-123456789abc'),
    ]);
    vi.mocked(fsPromises.access).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    vi.mocked(getVrcWorldInfoByWorldId).mockReturnValue(
      Effect.succeed(makeWorldInfo()),
    );
    const fetchError = new Error('Network error');
    fetchError.name = 'FetchError';
    vi.mocked(ofetch).mockRejectedValue(fetchError);

    const result = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );

    expect(result.generated).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('should re-throw unexpected errors instead of swallowing them', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([
      makeJoinLog('wrld_12345678-1234-1234-1234-123456789abc'),
    ]);
    vi.mocked(fsPromises.access).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    vi.mocked(getVrcWorldInfoByWorldId).mockReturnValue(
      Effect.succeed(makeWorldInfo()),
    );
    vi.mocked(ofetch).mockResolvedValue(new ArrayBuffer(8));
    vi.mocked(generateWorldJoinImage).mockReturnValue(
      Effect.succeed(Buffer.from('fake-jpeg')),
    );
    // mkdir で TypeError が発生 → 予期しないエラーなので re-throw されるべき
    vi.mocked(fsPromises.mkdir).mockRejectedValue(
      new TypeError('Cannot read properties of undefined'),
    );

    // Effect.runPromise は予期しないエラー（die）を FiberFailure でラップするため、
    // エラーメッセージでマッチする
    await expect(
      Effect.runPromise(
        generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
      ),
    ).rejects.toThrow('Cannot read properties of undefined');
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
    const promise1 = Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );
    // Second call should skip immediately due to mutex
    const result2 = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );
    await promise1;

    expect(result2.generated).toBe(0);
    expect(result2.skipped).toBe(0);
    expect(result2.errors).toBe(0);
  });

  it('should reset mutex after error', async () => {
    vi.mocked(findVRChatWorldJoinLogList).mockRejectedValueOnce(
      new Error('DB error'),
    );

    // First call throws
    await expect(
      Effect.runPromise(
        generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
      ),
    ).rejects.toThrow('DB error');

    // Mutex should be reset, second call should work
    vi.mocked(findVRChatWorldJoinLogList).mockResolvedValue([]);
    const result = await Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath: '/photos' }),
    );

    expect(result).toBeDefined();
  });
});
