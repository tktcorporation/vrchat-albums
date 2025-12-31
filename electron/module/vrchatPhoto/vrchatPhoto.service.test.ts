import * as crypto from 'node:crypto';
import type { Dirent, PathLike } from 'node:fs';
import * as nodefsPromises from 'node:fs/promises';
import * as dateFns from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FolderDigest, FolderDigestSchema } from '../../lib/brandedTypes';
import {
  getSettingStore,
  type PhotoFolderScanStates,
  type SettingStore,
} from '../settingStore';
import * as model from './model/vrchatPhotoPath.model';
import { VRChatPhotoDirPathSchema } from './valueObjects';
import * as service from './vrchatPhoto.service';

// --- Mocks ---
vi.mock('node:fs/promises');
vi.mock('./model/vrchatPhotoPath.model');
vi.mock('../settingStore');
vi.mock('folder-hash');
vi.mock('sharp', () => {
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

// folder-hash のインポート
import { hashElement } from 'folder-hash';

/**
 * フォルダパスからモックダイジェストを生成（folder-hash モック用）
 * folder-hash はフォルダのコンテンツに基づいてハッシュを計算するので、
 * テストではフォルダパスベースで一意のハッシュを返す
 */
const computeTestDigest = (folderPath: string): FolderDigest => {
  const hash = crypto.createHash('md5').update(folderPath).digest('hex');
  return FolderDigestSchema.parse(hash);
};

/**
 * 古い（変更を示す）ダイジェストを生成
 * テストで「ダイジェスト不一致」状態を作るために使用
 */
const createOldDigest = (suffix: string): FolderDigest => {
  const hash = crypto.createHash('md5').update(`old-${suffix}`).digest('hex');
  return FolderDigestSchema.parse(hash);
};

/**
 * Direntオブジェクトを作成するヘルパー
 */
const createMockDirent = (
  name: string,
  isDirectory: boolean,
): Partial<Dirent> => ({
  name,
  isDirectory: () => isDirectory,
  isFile: () => !isDirectory,
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isFIFO: () => false,
  isSocket: () => false,
  isSymbolicLink: () => false,
});

describe('createVRChatPhotoPathIndex', () => {
  const mockPhotoDir = VRChatPhotoDirPathSchema.parse('/mock/photos');
  const mockExtraDir = VRChatPhotoDirPathSchema.parse('/mock/extra_photos');
  const now = new Date();
  const oneHourAgo = dateFns.subHours(now, 1);
  const twoHoursAgo = dateFns.subHours(now, 2);
  const threeHoursAgo = dateFns.subHours(now, 3);

  // 年月フォルダ
  const yearMonthFolder2024_01 = '/mock/photos/2024-01';
  const yearMonthFolder2024_02 = '/mock/photos/2024-02';
  const extraYearMonthFolder = '/mock/extra_photos/2024-01';

  // ファイル名（年月フォルダ内）
  const file1Name = `VRChat_${dateFns.format(oneHourAgo, 'yyyy-MM-dd_HH-mm-ss.SSS')}_1920x1080.png`;
  const file2Name = `VRChat_${dateFns.format(threeHoursAgo, 'yyyy-MM-dd_HH-mm-ss.SSS')}_1280x720.png`;
  const extraFileName = `VRChat_${dateFns.format(now, 'yyyy-MM-dd_HH-mm-ss.SSS')}_1920x1080.png`;

  // フルパス
  const file1Path = `${yearMonthFolder2024_01}/${file1Name}`;
  const file2Path = `${yearMonthFolder2024_02}/${file2Name}`;
  const extraFilePath = `${extraYearMonthFolder}/${extraFileName}`;

  // モック用データ
  let mockSettingStore: Partial<SettingStore>;
  let savedScanStates: PhotoFolderScanStates;

  beforeEach(() => {
    savedScanStates = {};

    mockSettingStore = {
      getVRChatPhotoDir: vi.fn().mockReturnValue(mockPhotoDir.value),
      getVRChatPhotoExtraDirList: vi.fn().mockReturnValue([mockExtraDir]),
      getPhotoFolderScanStates: vi
        .fn()
        .mockImplementation(() => savedScanStates),
      setPhotoFolderScanStates: vi.fn().mockImplementation((states) => {
        savedScanStates = states;
      }),
      clearPhotoFolderScanStates: vi.fn(),
    };

    vi.mocked(getSettingStore).mockReturnValue(
      mockSettingStore as unknown as SettingStore,
    );

    // folder-hash モック - フォルダパスに基づいて一意のハッシュを返す
    vi.mocked(hashElement).mockImplementation(async (folderPath: string) => ({
      hash: computeTestDigest(folderPath),
      name: folderPath,
      children: [],
    }));

    // readdir モック - withFileTypesオプションの有無で振る舞いを変える
    // readdir は複雑なオーバーロードを持つため、any を使ってモック
    (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
      async (dirPath: PathLike, options?: unknown) => {
        const pathStr = dirPath.toString();

        // withFileTypes: true の場合は Dirent[] を返す
        // getPhotoFolders が再帰スキャンで使用
        if (
          options &&
          typeof options === 'object' &&
          'withFileTypes' in options &&
          (options as { withFileTypes: boolean }).withFileTypes
        ) {
          // ベースディレクトリ: サブフォルダを返す
          if (pathStr === mockPhotoDir.value) {
            return [
              createMockDirent('2024-01', true),
              createMockDirent('2024-02', true),
            ] as Dirent[];
          }
          if (pathStr === mockExtraDir.value) {
            return [createMockDirent('2024-01', true)] as Dirent[];
          }
          // 年月フォルダ: VRChat写真ファイルを返す（hasVRChatPhotos チェック用）
          if (pathStr === yearMonthFolder2024_01) {
            return [
              createMockDirent(file1Name, false), // VRChat写真ファイル
              createMockDirent('not-a-vrchat-file.txt', false),
            ] as Dirent[];
          }
          if (pathStr === yearMonthFolder2024_02) {
            return [createMockDirent(file2Name, false)] as Dirent[];
          }
          if (pathStr === extraYearMonthFolder) {
            return [createMockDirent(extraFileName, false)] as Dirent[];
          }
          return [] as Dirent[];
        }

        // withFileTypes なしの場合は string[] を返す（ファイル一覧取得用）
        if (pathStr === yearMonthFolder2024_01) {
          return [file1Name, 'not-a-vrchat-file.txt'];
        }
        if (pathStr === yearMonthFolder2024_02) {
          return [file2Name];
        }
        if (pathStr === extraYearMonthFolder) {
          return [extraFileName];
        }
        return [];
      },
    );

    // stat モック - mtimeを返す
    vi.mocked(nodefsPromises.stat).mockImplementation(async (filePath) => {
      const pathStr = filePath.toString();
      const stats = {
        isFile: () => true,
        isDirectory: () => false,
        mtime: now, // デフォルト
      };

      if (pathStr === file1Path) {
        stats.mtime = oneHourAgo;
      } else if (pathStr === file2Path) {
        stats.mtime = threeHoursAgo;
      } else if (pathStr === extraFilePath) {
        stats.mtime = now;
      }

      return stats as unknown as Awaited<
        ReturnType<typeof nodefsPromises.stat>
      >;
    });

    // DB model モック
    vi.mocked(model.createOrUpdateListVRChatPhotoPath).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('フルスキャン（isIncremental = false）', () => {
    it('すべての写真ファイルを処理する', async () => {
      await service.createVRChatPhotoPathIndex(false);

      // DB保存が呼ばれる
      expect(model.createOrUpdateListVRChatPhotoPath).toHaveBeenCalled();

      // 全ファイルが処理される
      const allSavedData = vi
        .mocked(model.createOrUpdateListVRChatPhotoPath)
        .mock.calls.flatMap((call) => call[0]);

      expect(allSavedData).toHaveLength(3);
      const savedPaths = allSavedData.map((d) => d.photoPath);
      expect(savedPaths).toContain(file1Path);
      expect(savedPaths).toContain(file2Path);
      expect(savedPaths).toContain(extraFilePath);
    });

    it('スキャン状態が保存される', async () => {
      await service.createVRChatPhotoPathIndex(false);

      expect(mockSettingStore.setPhotoFolderScanStates).toHaveBeenCalled();
      const setStatesMock = mockSettingStore.setPhotoFolderScanStates;
      expect(setStatesMock).toBeDefined();
      const savedStates = vi.mocked(
        setStatesMock as SettingStore['setPhotoFolderScanStates'],
      ).mock.calls[0][0];

      // 各フォルダの状態が保存される
      expect(savedStates[yearMonthFolder2024_01]).toBeDefined();
      expect(savedStates[yearMonthFolder2024_02]).toBeDefined();
      expect(savedStates[extraYearMonthFolder]).toBeDefined();

      // ダイジェストが正しく計算される（folder-hash はフォルダパスベースでハッシュ）
      expect(savedStates[yearMonthFolder2024_01].digest).toBe(
        computeTestDigest(yearMonthFolder2024_01),
      );
    });
  });

  describe('差分スキャン（isIncremental = true）', () => {
    it('ダイジェストが一致するフォルダはスキップする', async () => {
      // 事前にスキャン状態を設定（2024-01は変更なし、他は古いダイジェスト）
      const digest2024_01 = computeTestDigest(yearMonthFolder2024_01);
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          digest: digest2024_01,
          lastScannedAt: twoHoursAgo.toISOString(),
        },
        // 2024-02は古いダイジェスト（変更あり）+ 前回スキャン日時あり
        [yearMonthFolder2024_02]: {
          digest: createOldDigest('2024-02'),
          lastScannedAt: twoHoursAgo.toISOString(),
        },
        // extraも古いダイジェスト（変更あり）+ 前回スキャン日時あり
        [extraYearMonthFolder]: {
          digest: createOldDigest('extra'),
          lastScannedAt: twoHoursAgo.toISOString(),
        },
      };

      await service.createVRChatPhotoPathIndex(true);

      // 2024-01フォルダのファイルはstatが呼ばれない（ダイジェスト一致でスキップ）
      const statCalls = vi
        .mocked(nodefsPromises.stat)
        .mock.calls.map((call) => call[0].toString());
      expect(statCalls).not.toContain(file1Path);

      // 2024-02とextraフォルダは処理される（ダイジェスト不一致 → mtime比較 → stat呼び出し）
      expect(statCalls).toContain(file2Path);
      expect(statCalls).toContain(extraFilePath);
    });

    it('mtimeが前回スキャン以前のファイルはスキップする', async () => {
      // 2024-02フォルダは変更あり（ダイジェスト不一致）だがmtimeは古い
      savedScanStates = {
        [yearMonthFolder2024_02]: {
          digest: createOldDigest('different'),
          lastScannedAt: twoHoursAgo.toISOString(), // file2は3時間前なのでスキップ
        },
      };

      await service.createVRChatPhotoPathIndex(true);

      // DB保存データを確認
      const allSavedData = vi
        .mocked(model.createOrUpdateListVRChatPhotoPath)
        .mock.calls.flatMap((call) => call[0]);

      const savedPaths = allSavedData.map((d) => d.photoPath);
      // file2Path（3時間前）は含まれない
      expect(savedPaths).not.toContain(file2Path);
      // file1Path（1時間前）とextraFilePath（現在）は含まれる
      expect(savedPaths).toContain(file1Path);
      expect(savedPaths).toContain(extraFilePath);
    });

    it('前回スキャン日時がないフォルダは全ファイルを処理する', async () => {
      // 2024-01はダイジェスト不一致（初回スキャン扱い）
      savedScanStates = {};

      await service.createVRChatPhotoPathIndex(true);

      // 全ファイルが処理される
      const allSavedData = vi
        .mocked(model.createOrUpdateListVRChatPhotoPath)
        .mock.calls.flatMap((call) => call[0]);

      expect(allSavedData).toHaveLength(3);
    });

    it('更新されたファイルがない場合はDB保存処理を呼び出さない', async () => {
      // 全フォルダが変更なし（folder-hash はフォルダパスベースでハッシュ）
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          digest: computeTestDigest(yearMonthFolder2024_01),
          lastScannedAt: now.toISOString(),
        },
        [yearMonthFolder2024_02]: {
          digest: computeTestDigest(yearMonthFolder2024_02),
          lastScannedAt: now.toISOString(),
        },
        [extraYearMonthFolder]: {
          digest: computeTestDigest(extraYearMonthFolder),
          lastScannedAt: now.toISOString(),
        },
      };

      await service.createVRChatPhotoPathIndex(true);

      // DB保存が呼ばれない
      expect(model.createOrUpdateListVRChatPhotoPath).not.toHaveBeenCalled();
    });
  });

  describe('デフォルトパラメータ', () => {
    it('引数なしで呼び出すと差分スキャン（isIncremental = true）になる', async () => {
      // 全フォルダを変更なしにしてスキップを確認
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          digest: computeTestDigest(yearMonthFolder2024_01),
          lastScannedAt: now.toISOString(),
        },
        [yearMonthFolder2024_02]: {
          digest: computeTestDigest(yearMonthFolder2024_02),
          lastScannedAt: now.toISOString(),
        },
        [extraYearMonthFolder]: {
          digest: computeTestDigest(extraYearMonthFolder),
          lastScannedAt: now.toISOString(),
        },
      };

      // 引数なしで呼び出し
      await service.createVRChatPhotoPathIndex();

      // 差分スキャンなのでDB保存は呼ばれない
      expect(model.createOrUpdateListVRChatPhotoPath).not.toHaveBeenCalled();
    });
  });
});
