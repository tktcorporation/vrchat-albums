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
import type { PhotoIndexProgress } from './vrchatPhoto.service';

// --- Mocks ---
vi.mock('node:fs/promises');
vi.mock('./model/vrchatPhotoPath.model');
vi.mock('../settingStore');
vi.mock('hash-wasm');
vi.mock('@napi-rs/image', () => {
  class MockTransformer {
    metadata = vi.fn().mockResolvedValue({ width: 1920, height: 1080 });
    resize = vi.fn().mockReturnThis();
    webp = vi.fn().mockResolvedValue(Buffer.from('mockImageData'));
    png = vi.fn().mockResolvedValue(Buffer.from('mockImageData'));
  }
  return { Transformer: MockTransformer };
});
vi.mock('./../../lib/wrappedExifTool', () => ({
  readImageDimensionsBatch: vi
    .fn()
    .mockResolvedValue([{ width: 1920, height: 1080 }]),
  readXmpTags: vi.fn(),
  writeDateTimeWithTimezone: vi.fn(),
  setExifToBuffer: vi.fn(),
}));
vi.mock('./../../lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// hash-wasm のインポート
import { xxhash128 } from 'hash-wasm';

import { readImageDimensionsBatch } from './../../lib/wrappedExifTool';

/**
 * ファイル名リストからモックダイジェストを生成（hash-wasm モック用）
 * 実際の xxhash128 はファイル名リストをハッシュ化するので、
 * テストでは入力文字列ベースで一意のハッシュを返す
 */
const computeTestDigest = (input: string): FolderDigest => {
  const hash = crypto.createHash('md5').update(input).digest('hex');
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
 * フォルダ内のVRChatファイル名リストから期待されるダイジェストを計算
 * 実際の computeFolderDigest と同じロジック:
 * - VRChat_*.png ファイルのみをフィルタ
 * - ソートして改行で結合
 * - xxhash128 でハッシュ化
 */
const computeExpectedDigestForFolder = (files: string[]): FolderDigest => {
  const pngFiles = files
    .filter((f) => f.startsWith('VRChat_') && f.endsWith('.png'))
    .toSorted();
  return computeTestDigest(pngFiles.join('\n'));
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

    // hash-wasm モック - ファイル名リストに基づいて一意のハッシュを返す
    // xxhash128 は IDataType (string | Buffer) を受け取るため、型アサーションを使用
    vi.mocked(xxhash128).mockImplementation(async (input) =>
      computeTestDigest(String(input)),
    );

    // readdir モック - withFileTypesオプションの有無で振る舞いを変える
    // readdir は複雑なオーバーロードを持つため、any を使ってモック
    (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
      (async (dirPath: PathLike, options?: unknown) => {
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
      }) as never,
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

    // readFile モック - サムネイル生成（@napi-rs/image）用のダミーバッファを返す
    vi.mocked(nodefsPromises.readFile).mockResolvedValue(
      Buffer.from('fake_image_data'),
    );

    // readImageDimensionsBatch モック - 渡されたパス数に応じて結果を返す
    vi.mocked(readImageDimensionsBatch).mockImplementation(async (paths) =>
      paths.map(() => ({ width: 1920, height: 1080 })),
    );

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

      // ダイジェストが正しく計算される（hash-wasm はファイル名リストベースでハッシュ）
      expect(savedStates[yearMonthFolder2024_01].digest).toBe(
        computeExpectedDigestForFolder([file1Name, 'not-a-vrchat-file.txt']),
      );
    });
  });

  describe('差分スキャン（isIncremental = true）', () => {
    it('ダイジェストが一致するフォルダはスキップする', async () => {
      // 事前にスキャン状態を設定（2024-01は変更なし、他は古いダイジェスト）
      const digest2024_01 = computeExpectedDigestForFolder([
        file1Name,
        'not-a-vrchat-file.txt',
      ]);
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
      // 全フォルダが変更なし（hash-wasm はファイル名リストベースでハッシュ）
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          digest: computeExpectedDigestForFolder([
            file1Name,
            'not-a-vrchat-file.txt',
          ]),
          lastScannedAt: now.toISOString(),
        },
        [yearMonthFolder2024_02]: {
          digest: computeExpectedDigestForFolder([file2Name]),
          lastScannedAt: now.toISOString(),
        },
        [extraYearMonthFolder]: {
          digest: computeExpectedDigestForFolder([extraFileName]),
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
          digest: computeExpectedDigestForFolder([
            file1Name,
            'not-a-vrchat-file.txt',
          ]),
          lastScannedAt: now.toISOString(),
        },
        [yearMonthFolder2024_02]: {
          digest: computeExpectedDigestForFolder([file2Name]),
          lastScannedAt: now.toISOString(),
        },
        [extraYearMonthFolder]: {
          digest: computeExpectedDigestForFolder([extraFileName]),
          lastScannedAt: now.toISOString(),
        },
      };

      // 引数なしで呼び出し
      await service.createVRChatPhotoPathIndex();

      // 差分スキャンなのでDB保存は呼ばれない
      expect(model.createOrUpdateListVRChatPhotoPath).not.toHaveBeenCalled();
    });
  });

  describe('エラーハンドリング', () => {
    describe('computeFolderDigest エラー', () => {
      it('フォルダ削除エラー（ENOENT）が発生した場合はスキップしてdebugログを出力する', async () => {
        // readdir がENOENTエラーを返すようにモック（computeFolderDigest内で呼ばれる）
        const originalReaddirMock = vi.mocked(nodefsPromises.readdir);
        const originalImplementation =
          originalReaddirMock.getMockImplementation();
        (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
          (async (dirPath: PathLike, options?: unknown) => {
            const pathStr = dirPath.toString();
            // computeFolderDigest で呼ばれる readdir（withFileTypes なし）
            if (
              pathStr === yearMonthFolder2024_01 &&
              (!options ||
                !(options as { withFileTypes?: boolean }).withFileTypes)
            ) {
              const error = new Error('ENOENT: no such file or directory');
              (error as NodeJS.ErrnoException).code = 'ENOENT';
              throw error;
            }
            // それ以外はオリジナルの実装を呼ぶ
            // biome-ignore lint/suspicious/noExplicitAny: readdir mock type
            return originalImplementation?.(dirPath, options as any);
          }) as never,
        );

        // loggerモジュールをインポート
        const { logger } = await import('./../../lib/logger');

        await service.createVRChatPhotoPathIndex(false);

        // debugログが呼ばれることを確認
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Folder not found'),
        );

        // 他のフォルダは処理される
        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);
        const savedPaths = allSavedData.map((d) => d.photoPath);
        // yearMonthFolder2024_01 は含まれない
        expect(savedPaths).not.toContain(file1Path);
        // 他のファイルは処理される
        expect(savedPaths).toContain(file2Path);
        expect(savedPaths).toContain(extraFilePath);
      });

      it('権限エラー（EACCES）が発生した場合はスキップしてwarnログを出力する', async () => {
        // readdir がEACCESエラーを返すようにモック
        const originalReaddirMock = vi.mocked(nodefsPromises.readdir);
        const originalImplementation =
          originalReaddirMock.getMockImplementation();
        (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
          (async (dirPath: PathLike, options?: unknown) => {
            const pathStr = dirPath.toString();
            // computeFolderDigest で呼ばれる readdir（withFileTypes なし）
            if (
              pathStr === yearMonthFolder2024_02 &&
              (!options ||
                !(options as { withFileTypes?: boolean }).withFileTypes)
            ) {
              const error = new Error('EACCES: permission denied');
              (error as NodeJS.ErrnoException).code = 'EACCES';
              throw error;
            }
            // biome-ignore lint/suspicious/noExplicitAny: readdir mock type
            return originalImplementation?.(dirPath, options as any);
          }) as never,
        );

        const { logger } = await import('./../../lib/logger');

        await service.createVRChatPhotoPathIndex(false);

        // warnログが呼ばれることを確認
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Permission denied'),
          }),
        );

        // file2Path（2024-02）は含まれない
        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);
        const savedPaths = allSavedData.map((d) => d.photoPath);
        expect(savedPaths).not.toContain(file2Path);
      });

      it('想定外エラーは再スローする（Sentry送信対象）', async () => {
        const unexpectedError = new Error('EMFILE: too many open files');
        (unexpectedError as NodeJS.ErrnoException).code = 'EMFILE';
        // readdir が想定外エラーを返すようにモック
        const originalReaddirMock = vi.mocked(nodefsPromises.readdir);
        const originalImplementation =
          originalReaddirMock.getMockImplementation();
        (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
          (async (dirPath: PathLike, options?: unknown) => {
            const pathStr = dirPath.toString();
            // computeFolderDigest で呼ばれる readdir（withFileTypes なし）
            if (
              pathStr === yearMonthFolder2024_01 &&
              (!options ||
                !(options as { withFileTypes?: boolean }).withFileTypes)
            ) {
              throw unexpectedError;
            }
            // biome-ignore lint/suspicious/noExplicitAny: readdir mock type
            return originalImplementation?.(dirPath, options as any);
          }) as never,
        );

        // 予期しないエラー（die）はラップされず、元のエラーオブジェクトのまま reject される
        await expect(service.createVRChatPhotoPathIndex(false)).rejects.toBe(
          unexpectedError,
        );
      });
    });

    describe('getPhotoFolders エラー（readdir）', () => {
      it('サブディレクトリの権限エラーをwarnログ出力してスキップする', async () => {
        // readdir を再モック
        (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
          (async (dirPath: PathLike, options?: unknown) => {
            const pathStr = dirPath.toString();

            // 2024-01フォルダで権限エラーを発生させる
            if (pathStr === yearMonthFolder2024_01) {
              const error = new Error('EACCES: permission denied');
              (error as NodeJS.ErrnoException).code = 'EACCES';
              throw error;
            }

            // withFileTypes: true の場合
            if (
              options &&
              typeof options === 'object' &&
              'withFileTypes' in options &&
              (options as { withFileTypes: boolean }).withFileTypes
            ) {
              if (pathStr === mockPhotoDir.value) {
                return [
                  createMockDirent('2024-01', true),
                  createMockDirent('2024-02', true),
                ] as Dirent[];
              }
              if (pathStr === mockExtraDir.value) {
                return [createMockDirent('2024-01', true)] as Dirent[];
              }
              if (pathStr === yearMonthFolder2024_02) {
                return [createMockDirent(file2Name, false)] as Dirent[];
              }
              if (pathStr === extraYearMonthFolder) {
                return [createMockDirent(extraFileName, false)] as Dirent[];
              }
              return [] as Dirent[];
            }

            if (pathStr === yearMonthFolder2024_02) {
              return [file2Name];
            }
            if (pathStr === extraYearMonthFolder) {
              return [extraFileName];
            }
            return [];
          }) as never,
        );

        const { logger } = await import('./../../lib/logger');

        await service.createVRChatPhotoPathIndex(false);

        // warnログが呼ばれることを確認
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              'Permission denied reading directory',
            ),
          }),
        );

        // file1Path（2024-01）は含まれない
        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);
        const savedPaths = allSavedData.map((d) => d.photoPath);
        expect(savedPaths).not.toContain(file1Path);
        // 他のファイルは処理される
        expect(savedPaths).toContain(file2Path);
      });

      it('readdir の想定外エラーは再スローする', async () => {
        const unexpectedError = new Error('EMFILE: too many open files');
        (unexpectedError as NodeJS.ErrnoException).code = 'EMFILE';

        (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
          (async (dirPath: PathLike, options?: unknown) => {
            const pathStr = dirPath.toString();

            // ベースディレクトリへのアクセスで想定外エラー
            if (
              pathStr === mockPhotoDir.value &&
              options &&
              typeof options === 'object' &&
              'withFileTypes' in options
            ) {
              throw unexpectedError;
            }
            return [];
          }) as never,
        );

        await expect(service.createVRChatPhotoPathIndex(false)).rejects.toThrow(
          unexpectedError,
        );
      });
    });

    describe('filterNewFilesByMtime エラー（stat）', () => {
      it('stat中にファイルが削除された場合はdebugログを出力してスキップする', async () => {
        // ダイジェスト不一致 + lastScannedAt設定でstat呼び出しを発生させる
        // lastScannedAtを過去に設定することで、mtimeチェックのためにstatが呼ばれる
        savedScanStates = {
          [yearMonthFolder2024_01]: {
            digest: createOldDigest('2024-01'), // 不一致
            lastScannedAt: twoHoursAgo.toISOString(),
          },
          [yearMonthFolder2024_02]: {
            digest: createOldDigest('2024-02'), // 不一致
            lastScannedAt: twoHoursAgo.toISOString(),
          },
          [extraYearMonthFolder]: {
            digest: createOldDigest('extra'), // 不一致
            lastScannedAt: twoHoursAgo.toISOString(),
          },
        };

        // statモックを変更: file1Pathで削除エラー
        vi.mocked(nodefsPromises.stat).mockImplementation(async (filePath) => {
          const pathStr = filePath.toString();
          if (pathStr === file1Path) {
            const error = new Error('ENOENT: no such file or directory');
            (error as NodeJS.ErrnoException).code = 'ENOENT';
            throw error;
          }
          const stats = {
            isFile: () => true,
            isDirectory: () => false,
            mtime: now, // twoHoursAgoより後なので新規ファイルとして処理される
          };
          return stats as unknown as Awaited<
            ReturnType<typeof nodefsPromises.stat>
          >;
        });

        const { logger } = await import('./../../lib/logger');

        await service.createVRChatPhotoPathIndex(true);

        // debugログが呼ばれることを確認
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('File not found'),
        );

        // file1Pathは含まれない
        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);
        const savedPaths = allSavedData.map((d) => d.photoPath);
        expect(savedPaths).not.toContain(file1Path);
        // 他のファイルは処理される
        expect(savedPaths).toContain(file2Path);
        expect(savedPaths).toContain(extraFilePath);
      });

      it('ファイル権限エラーはwarnログを出力してスキップする', async () => {
        // ダイジェスト不一致 + lastScannedAt設定でstat呼び出しを発生させる
        savedScanStates = {
          [yearMonthFolder2024_01]: {
            digest: createOldDigest('2024-01'),
            lastScannedAt: twoHoursAgo.toISOString(),
          },
          [yearMonthFolder2024_02]: {
            digest: createOldDigest('2024-02'),
            lastScannedAt: twoHoursAgo.toISOString(),
          },
          [extraYearMonthFolder]: {
            digest: createOldDigest('extra'),
            lastScannedAt: twoHoursAgo.toISOString(),
          },
        };

        vi.mocked(nodefsPromises.stat).mockImplementation(async (filePath) => {
          const pathStr = filePath.toString();
          if (pathStr === extraFilePath) {
            const error = new Error('EACCES: permission denied');
            (error as NodeJS.ErrnoException).code = 'EACCES';
            throw error;
          }
          const stats = {
            isFile: () => true,
            isDirectory: () => false,
            mtime: now,
          };
          return stats as unknown as Awaited<
            ReturnType<typeof nodefsPromises.stat>
          >;
        });

        const { logger } = await import('./../../lib/logger');

        await service.createVRChatPhotoPathIndex(true);

        // warnログが呼ばれることを確認
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              'Permission denied accessing file',
            ),
          }),
        );

        // extraFilePathは含まれない
        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);
        const savedPaths = allSavedData.map((d) => d.photoPath);
        expect(savedPaths).not.toContain(extraFilePath);
        // 他のファイルは処理される
        expect(savedPaths).toContain(file1Path);
        expect(savedPaths).toContain(file2Path);
      });

      it('stat の想定外エラーは再スローする', async () => {
        // ダイジェスト不一致 + lastScannedAt設定でstat呼び出しを発生させる
        savedScanStates = {
          [yearMonthFolder2024_01]: {
            digest: createOldDigest('2024-01'),
            lastScannedAt: twoHoursAgo.toISOString(),
          },
        };

        const unexpectedError = new Error('EMFILE: too many open files');
        (unexpectedError as NodeJS.ErrnoException).code = 'EMFILE';

        vi.mocked(nodefsPromises.stat).mockRejectedValue(unexpectedError);

        // 予期しないエラー（die）はラップされず、元のエラーオブジェクトのまま reject される
        await expect(service.createVRChatPhotoPathIndex(true)).rejects.toBe(
          unexpectedError,
        );
      });
    });

    describe('readImageDimensionsBatch エラー', () => {
      it('null が返った写真はデフォルトサイズ(1920x1080)でDB保存する', async () => {
        // file1Path の dimensions だけ null を返す
        vi.mocked(readImageDimensionsBatch).mockImplementation(async (paths) =>
          paths.map((p) =>
            p.includes(file1Name) ? null : { width: 3840, height: 2160 },
          ),
        );

        await service.createVRChatPhotoPathIndex(false);

        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);

        // file1Path はデフォルトサイズで保存される（スキップされない）
        const file1Data = allSavedData.find((d) => d.photoPath === file1Path);
        expect(file1Data).toBeDefined();
        expect(file1Data?.width).toBe(1920);
        expect(file1Data?.height).toBe(1080);

        // 他のファイルは正常なサイズで処理
        const file2Data = allSavedData.find((d) => d.photoPath === file2Path);
        expect(file2Data?.width).toBe(3840);
        expect(file2Data?.height).toBe(2160);
      });

      it('全て null が返った場合もデフォルトサイズでDB保存する', async () => {
        vi.mocked(readImageDimensionsBatch).mockResolvedValue([
          null,
          null,
          null,
        ]);

        await service.createVRChatPhotoPathIndex(false);

        // 全てデフォルトサイズで保存される
        expect(model.createOrUpdateListVRChatPhotoPath).toHaveBeenCalled();
        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);
        for (const data of allSavedData) {
          expect(data.width).toBe(1920);
          expect(data.height).toBe(1080);
        }
      });

      it('undefined が返った写真もデフォルトサイズでDB保存する', async () => {
        vi.mocked(readImageDimensionsBatch).mockImplementation(async (paths) =>
          paths.map((p) =>
            p.includes(file1Name) ? undefined : { width: 1920, height: 1080 },
          ),
        );

        await service.createVRChatPhotoPathIndex(false);

        const allSavedData = vi
          .mocked(model.createOrUpdateListVRChatPhotoPath)
          .mock.calls.flatMap((call) => call[0]);

        // file1Path もデフォルトサイズで保存される
        const file1Data = allSavedData.find((d) => d.photoPath === file1Path);
        expect(file1Data).toBeDefined();
        expect(file1Data?.width).toBe(1920);
        expect(file1Data?.height).toBe(1080);
      });
    });
  });

  describe('進捗通知', () => {
    it('フォルダの走査中は、全ディレクトリ合計のフォルダ数で 1 フォルダごとに進捗を通知する', async () => {
      const progress: PhotoIndexProgress[] = [];

      await service.createVRChatPhotoPathIndex(false, (p) => {
        progress.push(p);
      });

      // メイン 2 フォルダ + 追加ディレクトリ 1 フォルダ。2 つ目のディレクトリに入っても総数は変わらない
      const scan = progress.filter((p) => p.phase === 'scan');
      expect(scan).toEqual(
        [0, 1, 2, 3].map((foldersScanned) => ({
          phase: 'scan',
          foldersScanned,
          totalFolders: 3,
        })),
      );
      // 進捗は探索・走査・登録の順に届き、段階が戻らない
      const phaseOrder = { list: 0, scan: 1, register: 2 } as const;
      const phases = progress.map((p) => phaseOrder[p.phase]);
      expect(phases).toEqual(phases.toSorted((a, b) => a - b));
      expect(phases.at(-1)).toBe(phaseOrder.register);
    });

    it('フォルダ一覧の探索中は、ディレクトリと直下のサブディレクトリの単位で進捗を通知する', async () => {
      const progress: PhotoIndexProgress[] = [];

      await service.createVRChatPhotoPathIndex(false, (p) => {
        progress.push(p);
      });

      // メインは直下に 2024-01・2024-02、追加ディレクトリは直下に 2024-01 を持つ
      const list = progress.filter((p) => p.phase === 'list');
      expect(list).toEqual(
        (
          [
            [0, 0, 2],
            [0, 1, 2],
            [0, 2, 2],
            [1, 0, 0],
            [1, 0, 1],
            [1, 1, 1],
            [2, 0, 0],
          ] as const
        ).map(([dirsListed, topLevelListed, topLevelTotal]) => ({
          phase: 'list',
          dirsListed,
          dirCount: 2,
          topLevelListed,
          topLevelTotal,
        })),
      );
      // 探索の進捗はすべて走査の進捗より前に届く
      expect(progress.findIndex((p) => p.phase === 'scan')).toBe(list.length);
    });

    it('画像として読めないファイルも処理済みに数え、最後に handled が total に届く', async () => {
      vi.mocked(readImageDimensionsBatch).mockImplementation(async (paths) =>
        paths.map(() => null),
      );
      const progress: { handled: number; total: number }[] = [];

      await service.createVRChatPhotoPathIndex(false, (p) => {
        if (p.phase === 'register') {
          progress.push({ handled: p.handled, total: p.total });
        }
      });

      expect(progress[0]).toEqual({ handled: 0, total: 3 });
      expect(progress.at(-1)).toEqual({ handled: 3, total: 3 });
      const handled = progress.map((p) => p.handled);
      expect(handled).toEqual(handled.toSorted((a, b) => a - b));
    });

    it('新規ファイルが無ければ走査の進捗だけを通知し、登録の進捗（0 / 0 の件数）は送らない', async () => {
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          digest: computeExpectedDigestForFolder([
            file1Name,
            'not-a-vrchat-file.txt',
          ]),
          lastScannedAt: now.toISOString(),
        },
        [yearMonthFolder2024_02]: {
          digest: computeExpectedDigestForFolder([file2Name]),
          lastScannedAt: now.toISOString(),
        },
        [extraYearMonthFolder]: {
          digest: computeExpectedDigestForFolder([extraFileName]),
          lastScannedAt: now.toISOString(),
        },
      };
      const progress: PhotoIndexProgress[] = [];

      await service.createVRChatPhotoPathIndex(true, (p) => {
        progress.push(p);
      });

      expect(progress.some((p) => p.phase === 'register')).toBe(false);
      expect(progress.at(-1)).toEqual({
        phase: 'scan',
        foldersScanned: 3,
        totalFolders: 3,
      });
    });
  });

  describe('lastScannedAt', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('登録の途中で作られたファイルも、次回の差分スキャンで拾われる', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const listedAt = dateFns.addMinutes(now, 1);
      vi.setSystemTime(listedAt);

      // 1 回目のスキャンの登録処理中（一覧を取った後）にファイルが作られる
      const lateFileName = `VRChat_${dateFns.format(dateFns.addMinutes(listedAt, 5), 'yyyy-MM-dd_HH-mm-ss.SSS')}_1920x1080.png`;
      const lateFilePath = `${yearMonthFolder2024_01}/${lateFileName}`;
      const lateFileMtime = dateFns.addMinutes(listedAt, 5);
      let lateFileExists = false;
      vi.mocked(model.createOrUpdateListVRChatPhotoPath).mockImplementation(
        async () => {
          lateFileExists = true;
          vi.setSystemTime(dateFns.addMinutes(listedAt, 10));
          return [];
        },
      );

      const baseReaddir = vi
        .mocked(nodefsPromises.readdir)
        .getMockImplementation();
      if (!baseReaddir) {
        throw new Error('readdir mock is not set');
      }
      (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
        (async (dirPath: PathLike, options?: unknown) => {
          const base = await (
            baseReaddir as (p: PathLike, o?: unknown) => Promise<unknown[]>
          )(dirPath, options);
          if (
            !lateFileExists ||
            dirPath.toString() !== yearMonthFolder2024_01
          ) {
            return base;
          }
          const withFileTypes =
            typeof options === 'object' &&
            options !== null &&
            'withFileTypes' in options;
          return [
            ...base,
            withFileTypes
              ? createMockDirent(lateFileName, false)
              : lateFileName,
          ];
        }) as never,
      );
      const baseStat = vi.mocked(nodefsPromises.stat).getMockImplementation();
      if (!baseStat) {
        throw new Error('stat mock is not set');
      }
      vi.mocked(nodefsPromises.stat).mockImplementation(async (filePath) => {
        if (filePath.toString() === lateFilePath) {
          return {
            isFile: () => true,
            isDirectory: () => false,
            mtime: lateFileMtime,
          } as unknown as Awaited<ReturnType<typeof nodefsPromises.stat>>;
        }
        return baseStat(filePath);
      });

      await service.createVRChatPhotoPathIndex(true);

      // 保存される時刻は登録の終了時刻ではなく、一覧を取った時刻
      expect(savedScanStates[yearMonthFolder2024_01].lastScannedAt).toBe(
        listedAt.toISOString(),
      );

      vi.mocked(model.createOrUpdateListVRChatPhotoPath).mockClear();
      await service.createVRChatPhotoPathIndex(true);

      const savedPaths = vi
        .mocked(model.createOrUpdateListVRChatPhotoPath)
        .mock.calls.flatMap((call) => call[0])
        .map((d) => d.photoPath);
      expect(savedPaths).toEqual([lateFilePath]);
    });

    it('追加ディレクトリのフォルダには、そのディレクトリの一覧を取り始める直前の時刻を保存する', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const mainListedAt = dateFns.addMinutes(now, 1);
      const extraListedAt = dateFns.addMinutes(now, 2);
      const afterExtraListing = dateFns.addMinutes(now, 3);
      vi.setSystemTime(mainListedAt);

      // メインの最後のフォルダを読んだところで時刻を進め、追加ディレクトリの直下を読んだところでさらに進める
      const baseReaddir = vi
        .mocked(nodefsPromises.readdir)
        .getMockImplementation();
      if (!baseReaddir) {
        throw new Error('readdir mock is not set');
      }
      (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
        (async (dirPath: PathLike, options?: unknown) => {
          const result = await (
            baseReaddir as (p: PathLike, o?: unknown) => Promise<unknown[]>
          )(dirPath, options);
          const isListing =
            typeof options === 'object' &&
            options !== null &&
            'withFileTypes' in options;
          if (isListing && dirPath.toString() === yearMonthFolder2024_02) {
            vi.setSystemTime(extraListedAt);
          }
          if (isListing && dirPath.toString() === mockExtraDir.value) {
            vi.setSystemTime(afterExtraListing);
          }
          return result;
        }) as never,
      );

      await service.createVRChatPhotoPathIndex(false);

      expect(savedScanStates[yearMonthFolder2024_01].lastScannedAt).toBe(
        mainListedAt.toISOString(),
      );
      expect(savedScanStates[extraYearMonthFolder].lastScannedAt).toBe(
        extraListedAt.toISOString(),
      );
    });
  });

  describe('ワールドIDを含む写真のパス（worldJoinPhotoPaths）', () => {
    const worldId = 'wrld_12345678-1234-1234-1234-123456789abc';
    const wrldPngName = `VRChat_2024-01-05_10-00-00.000_${worldId}.png`;
    const wrldJpgName = `VRChat_2024-02-05_10-00-00.000_${worldId}.jpg`;
    const extraWrldName = `VRChat_2024-01-06_10-00-00.000_${worldId}.png`;
    // 接頭辞の直後に wrld_ が続く名前は `VRChat_*_wrld_*` に合わない
    const prefixOnlyName = `VRChat_${worldId}.png`;
    const nestedFolder = `${yearMonthFolder2024_02}/nested`;

    const wrldPngPath = `${yearMonthFolder2024_01}/${wrldPngName}`;
    const wrldJpgPath = `${nestedFolder}/${wrldJpgName}`;
    const extraWrldPath = `${extraYearMonthFolder}/${extraWrldName}`;

    const folder2024_01Files = [
      file1Name,
      wrldPngName,
      prefixOnlyName,
      'not-a-vrchat-file.txt',
    ];

    beforeEach(() => {
      const listing: Record<string, Partial<Dirent>[]> = {
        [mockPhotoDir.value]: [
          createMockDirent('2024-01', true),
          createMockDirent('2024-02', true),
        ],
        [yearMonthFolder2024_01]: folder2024_01Files.map((name) =>
          createMockDirent(name, false),
        ),
        [yearMonthFolder2024_02]: [
          createMockDirent(file2Name, false),
          createMockDirent('nested', true),
        ],
        [nestedFolder]: [createMockDirent(wrldJpgName, false)],
        [mockExtraDir.value]: [createMockDirent('2024-01', true)],
        [extraYearMonthFolder]: [createMockDirent(extraWrldName, false)],
      };
      (nodefsPromises.readdir as ReturnType<typeof vi.fn>).mockImplementation(
        (async (dirPath: PathLike, options?: unknown) => {
          const entries = listing[dirPath.toString()] ?? [];
          const withFileTypes =
            typeof options === 'object' &&
            options !== null &&
            'withFileTypes' in options;
          return withFileTypes
            ? (entries as Dirent[])
            : entries.map((entry) => entry.name);
        }) as never,
      );
    });

    it('メインの写真ディレクトリ配下を入れ子のフォルダまで含めて返し、拡張子は問わない', async () => {
      const result = await service.createVRChatPhotoPathIndex(false);

      expect(result.worldJoinPhotoPaths.toSorted()).toStrictEqual(
        [wrldPngPath, wrldJpgPath].toSorted(),
      );
    });

    it('追加の写真ディレクトリのファイルは含めない', async () => {
      const result = await service.createVRChatPhotoPathIndex(false);

      expect(result.worldJoinPhotoPaths).not.toContain(extraWrldPath);
    });

    it('差分スキャンでダイジェストが変わっていないフォルダのファイルも返す', async () => {
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          digest: computeExpectedDigestForFolder(folder2024_01Files),
          lastScannedAt: twoHoursAgo.toISOString(),
        },
      };

      const result = await service.createVRChatPhotoPathIndex(true);

      // ダイジェスト一致でファイルの mtime は見ていない
      const statCalls = vi
        .mocked(nodefsPromises.stat)
        .mock.calls.map((call) => call[0].toString());
      expect(statCalls).not.toContain(wrldPngPath);
      expect(result.worldJoinPhotoPaths).toContain(wrldPngPath);
    });

    it('走査済みのフォルダへ古い mtime のままコピーされたファイルも返す', async () => {
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          // コピー前のファイル一覧のダイジェスト
          digest: computeExpectedDigestForFolder([
            file1Name,
            'not-a-vrchat-file.txt',
          ]),
          lastScannedAt: twoHoursAgo.toISOString(),
        },
      };
      // コピーで mtime が保たれ、前回スキャンより古い
      const mtimes = new Map<string, Date>([
        [file1Path, oneHourAgo],
        [wrldPngPath, threeHoursAgo],
      ]);
      vi.mocked(nodefsPromises.stat).mockImplementation(
        async (filePath) =>
          ({
            isFile: () => true,
            isDirectory: () => false,
            mtime: mtimes.get(filePath.toString()) ?? now,
          }) as unknown as Awaited<ReturnType<typeof nodefsPromises.stat>>,
      );

      const result = await service.createVRChatPhotoPathIndex(true);

      // mtime が前回スキャンより古いので登録対象からは外れる
      const savedPaths = vi
        .mocked(model.createOrUpdateListVRChatPhotoPath)
        .mock.calls.flatMap((call) => call[0])
        .map((d) => d.photoPath);
      expect(savedPaths).not.toContain(wrldPngPath);
      expect(result.worldJoinPhotoPaths).toContain(wrldPngPath);
    });

    it('全フォルダのダイジェストが変わらず登録対象が無くてもパスを返す', async () => {
      savedScanStates = {
        [yearMonthFolder2024_01]: {
          digest: computeExpectedDigestForFolder(folder2024_01Files),
          lastScannedAt: twoHoursAgo.toISOString(),
        },
        [yearMonthFolder2024_02]: {
          digest: computeExpectedDigestForFolder([file2Name, 'nested']),
          lastScannedAt: twoHoursAgo.toISOString(),
        },
        [extraYearMonthFolder]: {
          digest: computeExpectedDigestForFolder([extraWrldName]),
          lastScannedAt: twoHoursAgo.toISOString(),
        },
      };

      const result = await service.createVRChatPhotoPathIndex(true);

      expect(model.createOrUpdateListVRChatPhotoPath).not.toHaveBeenCalled();
      expect(result.createdModels).toStrictEqual([]);
      expect(result.worldJoinPhotoPaths.toSorted()).toStrictEqual(
        [wrldPngPath, wrldJpgPath].toSorted(),
      );
    });
  });
});
