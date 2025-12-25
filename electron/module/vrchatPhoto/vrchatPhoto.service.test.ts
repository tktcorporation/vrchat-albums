import * as nodefsPromises from 'node:fs/promises'; // 明示的にインポート
import * as dateFns from 'date-fns';
import { glob } from 'glob';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettingStore, type SettingStore } from '../settingStore';
import * as model from './model/vrchatPhotoPath.model';
import { VRChatPhotoDirPathSchema } from './valueObjects';
import * as service from './vrchatPhoto.service';

// --- Mocks ---
vi.mock('glob');
// モックの変更 - fs/promises の代わりに node:fs/promises をモック
vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockImplementation(async (path) => {
    const pathStr = path.toString();
    // この allStats オブジェクトはテストコード内のグローバルスコープで定義されているので
    // モックの実装内で直接参照できません。代わりに条件分岐で返り値を判断します。
    if (
      pathStr.includes('/mock/photos/VRChat_') ||
      pathStr.includes('/mock/extra_photos/VRChat_')
    ) {
      const now = new Date();
      // 仮のstatsを返す
      return {
        mtime: pathStr.includes('mock/photos/subdir')
          ? dateFns.subHours(now, 3) // 3時間前
          : pathStr.includes('mock/extra_photos')
            ? now // 現在
            : dateFns.subHours(now, 1), // 1時間前
        isFile: () => true,
        isDirectory: () => false,
      };
    }
    throw new Error(`ENOENT: no such file or directory, stat '${pathStr}'`);
  }),
}));
vi.mock('./model/vrchatPhotoPath.model');
vi.mock('../settingStore');
vi.mock('sharp', () => {
  // sharp() is chainable, so mock constructor and methods
  const mockSharpInstance = {
    metadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mockImageData')),
  };
  return {
    default: vi.fn(() => mockSharpInstance),
  };
});
vi.mock('./../../lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Helper to create mock file stats
// const _createMockStat = (mtime: Date): fs.Stats => ({
//   mtime,
//   isFile: () => true,
//   isDirectory: () => false,
//   isBlockDevice: () => false,
//   isCharacterDevice: () => false,
//   isSymbolicLink: () => false,
//   isFIFO: () => false,
//   isSocket: () => false,
//   dev: 0,
//   ino: 0,
//   mode: 0,
//   nlink: 0,
//   uid: 0,
//   gid: 0,
//   rdev: 0,
//   size: 1024,
//   blksize: 4096,
//   blocks: 1,
//   atimeMs: mtime.getTime(),
//   mtimeMs: mtime.getTime(),
//   ctimeMs: mtime.getTime(),
//   birthtimeMs: mtime.getTime(),
//   atime: mtime,
//   ctime: mtime,
//   birthtime: mtime,
// });

describe('createVRChatPhotoPathIndex', () => {
  const mockPhotoDir = VRChatPhotoDirPathSchema.parse('/mock/photos');
  const mockExtraDir = VRChatPhotoDirPathSchema.parse('/mock/extra_photos');
  const now = new Date();
  const oneHourAgo = dateFns.subHours(now, 1);
  const twoHoursAgo = dateFns.subHours(now, 2);
  const threeHoursAgo = dateFns.subHours(now, 3);

  const mockMainFiles = [
    `/mock/photos/VRChat_${dateFns.format(
      oneHourAgo,
      'yyyy-MM-dd_HH-mm-ss.SSS',
    )}_1920x1080.png`,
    `/mock/photos/subdir/VRChat_${dateFns.format(
      threeHoursAgo,
      'yyyy-MM-dd_HH-mm-ss.SSS',
    )}_1280x720.png`,
  ];
  const mockExtraFiles = [
    `/mock/extra_photos/VRChat_${dateFns.format(
      now,
      'yyyy-MM-dd_HH-mm-ss.SSS',
    )}_1920x1080.png`,
  ];
  const allFiles = [...mockMainFiles, ...mockExtraFiles];

  // const _allStats = { ...mockMainStats, ...mockExtraStats };

  beforeEach(() => {
    // Mock settings store
    const mockSettingStore: Partial<SettingStore> = {
      getVRChatPhotoDir: vi.fn().mockReturnValue(mockPhotoDir.value),
      getVRChatPhotoExtraDirList: vi.fn().mockReturnValue([mockExtraDir]),
      // other methods are not used in this test, so mock them minimally
    };

    vi.mocked(getSettingStore).mockReturnValue(
      mockSettingStore as unknown as SettingStore,
    );

    // Mock glob and glob.stream
    vi.mocked(glob).mockImplementation(async (pattern: string | string[]) => {
      const patternStr = Array.isArray(pattern) ? pattern.join(',') : pattern;
      if (typeof patternStr !== 'string') {
        return [];
      }
      if (patternStr.startsWith(`${mockPhotoDir.value}/**/`)) {
        return mockMainFiles;
      }
      if (patternStr.startsWith(`${mockExtraDir.value}/**/`)) {
        return mockExtraFiles;
      }
      return [];
    });

    // Mock glob.stream (used for streaming file enumeration)
    // @ts-expect-error - glob.stream is being mocked
    glob.stream = vi.fn().mockImplementation((pattern: string) => {
      // Create an async iterable from the files
      const files = pattern.startsWith(`${mockPhotoDir.value}/**/`)
        ? mockMainFiles
        : pattern.startsWith(`${mockExtraDir.value}/**/`)
          ? mockExtraFiles
          : [];

      return {
        [Symbol.asyncIterator]: async function* () {
          for (const file of files) {
            yield file;
          }
        },
      };
    });

    // Mock DB model
    vi.mocked(model.createOrUpdateListVRChatPhotoPath).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('初回実行時はすべての写真ファイルを処理する', async () => {
    await service.createVRChatPhotoPathIndex(null);

    // Check glob.stream calls (streaming API is now used)
    expect(glob.stream).toHaveBeenCalledTimes(2);
    expect(glob.stream).toHaveBeenCalledWith(
      `${mockPhotoDir.value}/**/VRChat_*.png`,
    );
    expect(glob.stream).toHaveBeenCalledWith(
      `${mockExtraDir.value}/**/VRChat_*.png`,
    );

    // Check stat calls (should NOT be called when no lastProcessedDate)
    expect(nodefsPromises.stat).toHaveBeenCalledTimes(0);

    // Check DB save call - now called multiple times due to batching
    expect(model.createOrUpdateListVRChatPhotoPath).toHaveBeenCalled();

    // Collect all saved data across all batches
    const allSavedData = vi
      .mocked(model.createOrUpdateListVRChatPhotoPath)
      .mock.calls.flatMap((call) => call[0]);

    expect(allSavedData).toHaveLength(allFiles.length);
    const savedPaths = allSavedData.map((d) => d.photoPath);
    expect(savedPaths).toEqual(expect.arrayContaining(allFiles));
  });

  it('差分実行時は更新された写真ファイルのみ処理する', async () => {
    const lastProcessedDate = twoHoursAgo;

    await service.createVRChatPhotoPathIndex(lastProcessedDate);

    // Check glob.stream calls
    expect(glob.stream).toHaveBeenCalledTimes(2);

    // Check stat calls for all files (to check mtime)
    expect(nodefsPromises.stat).toHaveBeenCalledTimes(allFiles.length);

    // Check DB save call with only updated files
    const expectedUpdatedFiles = [
      mockMainFiles[0], // modified 1 hour ago
      mockExtraFiles[0], // modified now
    ];
    expect(model.createOrUpdateListVRChatPhotoPath).toHaveBeenCalled();

    // Collect all saved data across all batches
    const allSavedData = vi
      .mocked(model.createOrUpdateListVRChatPhotoPath)
      .mock.calls.flatMap((call) => call[0]);

    expect(allSavedData).toHaveLength(expectedUpdatedFiles.length);
    const savedPaths = allSavedData.map((d) => d.photoPath);
    expect(savedPaths).toEqual(expect.arrayContaining(expectedUpdatedFiles));
    expect(savedPaths).not.toContain(mockMainFiles[1]); // Should not contain the file modified 3 hours ago
  });

  it('更新されたファイルがない場合はDB保存処理を呼び出さない', async () => {
    const lastProcessedDate = dateFns.addMinutes(now, 1);

    await service.createVRChatPhotoPathIndex(lastProcessedDate);

    // Check glob.stream calls
    expect(glob.stream).toHaveBeenCalledTimes(2);

    // Check stat calls
    expect(nodefsPromises.stat).toHaveBeenCalledTimes(allFiles.length);

    // Check DB save call (should NOT be called)
    expect(model.createOrUpdateListVRChatPhotoPath).not.toHaveBeenCalled();
  });
});
