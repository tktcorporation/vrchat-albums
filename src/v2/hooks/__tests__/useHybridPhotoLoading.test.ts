import { describe, expect, it, vi } from 'vitest';

// tRPCをモック（Electronのpreload依存を回避）
vi.mock('@/trpc', () => ({
  trpcReact: {
    useUtils: () => ({
      vrchatPhoto: {
        getVrchatPhotoPathsByIds: {
          fetch: vi.fn().mockResolvedValue([]),
        },
      },
    }),
    vrchatPhoto: {
      getVrchatPhotoMetadataList: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
  },
}));

// VRChat写真ファイル名のバリデーション正規表現
const VRCHAT_PHOTO_REGEX =
  /^VRChat_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}_\d+x\d+\.(png|jpg|jpeg)$/i;

// パスからファイル名を抽出する正規表現
const FILENAME_FROM_PATH_REGEX =
  /VRChat_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}_\d+x\d+\.(png|jpg|jpeg)$/i;

// VRChatPhotoFileNameWithExtSchema と VRChatPhotoPathSchema をモック
vi.mock('../../../valueObjects', () => ({
  VRChatPhotoFileNameWithExtSchema: {
    parse: (value: string) => {
      if (!VRCHAT_PHOTO_REGEX.test(value)) {
        throw new Error('Invalid VRChat photo filename format');
      }
      return { value, type: 'VRChatPhotoFileNameWithExt' as const };
    },
  },
  VRChatPhotoPathSchema: {
    parse: (value: string) => {
      const match = value.match(FILENAME_FROM_PATH_REGEX);
      if (!match) {
        throw new Error('Invalid VRChat photo path format');
      }
      const fileName = match[0];
      return {
        value,
        type: 'VRChatPhotoPath' as const,
        fileName: {
          value: fileName,
          type: 'VRChatPhotoFileNameWithExt' as const,
        },
      };
    },
    safeParse: (value: string) => {
      const match = value.match(FILENAME_FROM_PATH_REGEX);
      if (!match) {
        return {
          success: false,
          error: new Error('Invalid VRChat photo path'),
        };
      }
      const fileName = match[0];
      return {
        success: true,
        data: {
          value,
          type: 'VRChatPhotoPath' as const,
          fileName: {
            value: fileName,
            type: 'VRChatPhotoFileNameWithExt' as const,
          },
        },
      };
    },
  },
}));

// モックの後にインポート
import {
  createFullyLoadedPhoto,
  createMetadataOnlyPhoto,
  createPhotoArray,
} from '../useHybridPhotoLoading';

describe('useHybridPhotoLoading', () => {
  describe('createMetadataOnlyPhoto', () => {
    it('メタデータからPhotoMetadataOnly型を生成する', () => {
      const metadata = {
        id: 'photo-123',
        photoTakenAt: new Date('2024-01-15T10:30:00'),
        width: 1920,
        height: 1080,
      };

      const result = createMetadataOnlyPhoto(metadata);

      expect(result).toEqual({
        loadingState: 'metadata',
        id: 'photo-123',
        width: 1920,
        height: 1080,
        takenAt: metadata.photoTakenAt,
        location: {
          joinedAt: metadata.photoTakenAt,
        },
      });
    });

    it('loadingStateが"metadata"になる', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 800,
        height: 600,
      };

      const result = createMetadataOnlyPhoto(metadata);

      expect(result.loadingState).toBe('metadata');
    });

    it('photoPathプロパティが存在しない', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 800,
        height: 600,
      };

      const result = createMetadataOnlyPhoto(metadata);

      expect(result.photoPath).toBeUndefined();
      expect('photoPath' in result).toBe(false);
    });

    it('fileNameWithExtプロパティが存在しない', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 800,
        height: 600,
      };

      const result = createMetadataOnlyPhoto(metadata);

      expect(result.fileNameWithExt).toBeUndefined();
      expect('fileNameWithExt' in result).toBe(false);
    });
  });

  describe('createFullyLoadedPhoto', () => {
    it('有効なパスからPhotoFullyLoaded型を生成する', () => {
      const metadata = {
        id: 'photo-456',
        photoTakenAt: new Date('2024-02-20T14:45:00'),
        width: 3840,
        height: 2160,
      };
      const photoPath = '/photos/VRChat_2024-02-20_14-45-00.123_3840x2160.png';

      const result = createFullyLoadedPhoto(metadata, photoPath);

      expect(result).not.toBeNull();
      expect(result?.loadingState).toBe('loaded');
      expect(result?.id).toBe('photo-456');
      expect(result?.photoPath.value).toBe(photoPath);
      expect(result?.width).toBe(3840);
      expect(result?.height).toBe(2160);
    });

    it('loadingStateが"loaded"になる', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 1920,
        height: 1080,
      };
      const photoPath = '/photos/VRChat_2024-01-01_12-00-00.000_1920x1080.png';

      const result = createFullyLoadedPhoto(metadata, photoPath);

      expect(result?.loadingState).toBe('loaded');
    });

    it('photoPathプロパティが設定される', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 1920,
        height: 1080,
      };
      const photoPath = '/photos/VRChat_2024-01-01_12-00-00.000_1920x1080.png';

      const result = createFullyLoadedPhoto(metadata, photoPath);

      expect(result?.photoPath.value).toBe(photoPath);
    });

    it('fileNameWithExtがパスから抽出される', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 1920,
        height: 1080,
      };
      const filename = 'VRChat_2024-01-01_12-00-00.000_1920x1080.png';
      const photoPath = `/photos/${filename}`;

      const result = createFullyLoadedPhoto(metadata, photoPath);

      expect(result?.fileNameWithExt.value).toBe(filename);
    });

    it('無効なファイル名の場合はnullを返す', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 1920,
        height: 1080,
      };
      const invalidPath = '/photos/invalid-filename.png';

      const result = createFullyLoadedPhoto(metadata, invalidPath);

      expect(result).toBeNull();
    });

    it('ファイル名が空の場合はnullを返す', () => {
      const metadata = {
        id: 'test-id',
        photoTakenAt: new Date(),
        width: 1920,
        height: 1080,
      };
      const emptyPath = '';

      const result = createFullyLoadedPhoto(metadata, emptyPath);

      expect(result).toBeNull();
    });
  });

  describe('createPhotoArray', () => {
    it('パスがキャッシュにある場合はFullyLoadedを返す', () => {
      const metadataList = [
        {
          id: 'photo-1',
          photoTakenAt: new Date(),
          width: 1920,
          height: 1080,
        },
      ];
      const pathCache = new Map<string, string>();
      pathCache.set(
        'photo-1',
        '/photos/VRChat_2024-01-01_12-00-00.000_1920x1080.png',
      );

      const result = createPhotoArray(metadataList, pathCache);

      expect(result).toHaveLength(1);
      expect(result[0].loadingState).toBe('loaded');
    });

    it('パスがキャッシュにない場合はMetadataOnlyを返す', () => {
      const metadataList = [
        {
          id: 'photo-2',
          photoTakenAt: new Date(),
          width: 1920,
          height: 1080,
        },
      ];
      const pathCache = new Map<string, string>();

      const result = createPhotoArray(metadataList, pathCache);

      expect(result).toHaveLength(1);
      expect(result[0].loadingState).toBe('metadata');
    });

    it('混在したリストを正しく処理する', () => {
      const metadataList = [
        {
          id: 'photo-a',
          photoTakenAt: new Date(),
          width: 1920,
          height: 1080,
        },
        {
          id: 'photo-b',
          photoTakenAt: new Date(),
          width: 1920,
          height: 1080,
        },
        {
          id: 'photo-c',
          photoTakenAt: new Date(),
          width: 1920,
          height: 1080,
        },
      ];
      const pathCache = new Map<string, string>();
      pathCache.set(
        'photo-a',
        '/photos/VRChat_2024-01-01_12-00-00.000_1920x1080.png',
      );
      pathCache.set(
        'photo-c',
        '/photos/VRChat_2024-01-01_12-00-01.000_1920x1080.png',
      );

      const result = createPhotoArray(metadataList, pathCache);

      expect(result).toHaveLength(3);
      expect(result[0].loadingState).toBe('loaded');
      expect(result[1].loadingState).toBe('metadata');
      expect(result[2].loadingState).toBe('loaded');
    });

    it('空のメタデータリストは空の配列を返す', () => {
      const metadataList: Array<{
        id: string;
        photoTakenAt: Date;
        width: number;
        height: number;
      }> = [];
      const pathCache = new Map<string, string>();

      const result = createPhotoArray(metadataList, pathCache);

      expect(result).toHaveLength(0);
    });

    it('無効なパスはフィルタリングされる', () => {
      const metadataList = [
        {
          id: 'photo-valid',
          photoTakenAt: new Date(),
          width: 1920,
          height: 1080,
        },
        {
          id: 'photo-invalid',
          photoTakenAt: new Date(),
          width: 1920,
          height: 1080,
        },
      ];
      const pathCache = new Map<string, string>();
      pathCache.set(
        'photo-valid',
        '/photos/VRChat_2024-01-01_12-00-00.000_1920x1080.png',
      );
      pathCache.set('photo-invalid', '/photos/invalid-filename.png');

      const result = createPhotoArray(metadataList, pathCache);

      // photo-validはFullyLoaded、photo-invalidはnullなのでフィルタされる
      // ただしMetadataOnlyも含まれるはず...
      // 実装を確認: pathがあってcreateFullyLoadedPhotoがnullを返す場合
      // フィルタされる
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('photo-valid');
    });
  });
});
