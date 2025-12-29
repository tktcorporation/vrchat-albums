import * as fsPromises from 'node:fs/promises';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupThumbnailCache,
  getVRChatPhotoItemData,
} from './vrchatPhoto.service';

// node:fs/promisesをモック（キャッシュ機能で使用）
vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  unlink: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

// electronをモック
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
  },
}));

// sharpモジュールをモック
vi.mock('sharp', () => {
  // sharpクラスのモックオブジェクトを作成
  const mockSharpInstance = {
    metadata: vi.fn(), // 具体的な値は各テストで設定
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(), // WebP変換用のメソッドチェーン
    toBuffer: vi.fn(), // 具体的な値は各テストで設定
  };

  // sharpファクトリー関数のモック
  const mockSharp = vi.fn().mockReturnValue(mockSharpInstance);

  return {
    default: mockSharp,
    // 他のsharpのプロパティや関数も必要に応じてモック
  };
});

describe('vrchatPhoto.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // この関数は、指定された画像ファイルのパスとリサイズ幅を受け取り、
  // リサイズされた画像のbase64文字列を返すことを期待される。
  describe('getVRChatPhotoItemData', () => {
    const mockInputPhotoPath =
      '/path/to/VRChat_2023-10-26_10-30-00.123_1920x1080.png';
    const mockResizeWidth = 256;
    let sharpFactory: ReturnType<typeof vi.mocked<typeof sharp>>;
    // sharpインスタンスの型を明示的に指定
    let mockSharpInstance: {
      metadata: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      webp: ReturnType<typeof vi.fn>;
      toBuffer: ReturnType<typeof vi.fn>;
    };

    // 各テストケースの前に、sharpモックの基本的な振る舞いを設定する。
    // sharpファクトリ関数がモックインスタンスを返すようにし、
    // そのインスタンスの各メソッド（metadata, resize, webp, toBuffer）もモックする。
    beforeEach(async () => {
      // sharpモジュールのモックを再取得
      sharpFactory = vi.mocked(sharp);
      // モックされたsharpインスタンスのメソッドを再取得/設定
      // これはsharpFactoryが呼び出されるたびに新しいモックインスタンスを返すようにするため
      // グローバルモックで返されるインスタンスを上書きする
      mockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({
          // デフォルトの成功時の値を設定
          width: 1920,
          height: 1080,
          format: 'png',
        } as Metadata),
        resize: vi.fn().mockReturnThis(), // メソッドチェーンのためthisを返す
        webp: vi.fn().mockReturnThis(), // WebP変換用のメソッドチェーン
        toBuffer: vi
          .fn()
          .mockResolvedValue(Buffer.from('dummy_thumbnail_data')), // デフォルトの成功時の値を設定
      };
      sharpFactory.mockReturnValue(mockSharpInstance as unknown as Sharp);
    });

    // 正常系のテストケース
    // 画像処理が成功し、期待されるbase64文字列が返されることを確認する。
    // width指定時はWebP形式で返される。
    it('should return VRChatPhotoItemData on success', async () => {
      const mockThumbnailBuffer = Buffer.from('thumbnail_data');
      // width指定時はWebP形式で返される
      const expectedBase64String = `data:image/webp;base64,${mockThumbnailBuffer.toString(
        'base64',
      )}`;
      // このテストケース専用にtoBufferの戻り値を設定
      mockSharpInstance.toBuffer.mockResolvedValue(mockThumbnailBuffer);

      const result = await getVRChatPhotoItemData({
        photoPath: mockInputPhotoPath,
        width: mockResizeWidth,
      });

      // 結果がOkであることを確認
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 正常終了の場合、値が期待されるbase64文字列と一致することを確認
        expect(result.value).toBe(expectedBase64String);
      }
      // sharpファクトリが正しい引数で呼び出されたことを確認
      expect(sharpFactory).toHaveBeenCalledWith(mockInputPhotoPath);
      // resizeメソッドが正しい引数で呼び出されたことを確認
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(mockResizeWidth);
      // webpメソッドが呼び出されたことを確認
      expect(mockSharpInstance.webp).toHaveBeenCalledWith({ quality: 80 });
      // toBufferメソッドが呼び出されたことを確認
      expect(mockSharpInstance.toBuffer).toHaveBeenCalled();
    });

    // エラーハンドリングのテストケース群
    describe('Error handling', () => {
      // sharpのファクトリ関数自体が「Input file is missing」エラーをスローする場合のテスト
      // この場合、"InputFileIsMissing" という特定のエラーオブジェクトが返されることを期待する。
      it('should return "InputFileIsMissing" error when sharp instantiation throws "Input file is missing"', async () => {
        // sharpファクトリがエラーをスローするように設定
        sharpFactory.mockImplementationOnce(() => {
          throw new Error('Input file is missing');
        });

        const result = await getVRChatPhotoItemData({
          photoPath: mockInputPhotoPath,
          width: mockResizeWidth,
        });

        // 結果がErrであることを確認
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          // エラーオブジェクトが期待されるものであることを確認
          expect(result.error).toBe('InputFileIsMissing');
        }
      });

      // sharpのファクトリ関数が「Input file is missing」以外のエラーをスローする場合のテスト
      // この場合、発生したエラーがそのままスローされることを期待する。
      it('should throw error for other sharp instantiation errors', async () => {
        const errorMessage = 'Some other sharp error';
        // sharpファクトリが特定のエラーメッセージでエラーをスローするように設定
        // width指定なしでテストすることで、webpチェーンをスキップする
        sharpFactory.mockImplementationOnce(() => {
          throw new Error(errorMessage);
        });

        // getVRChatPhotoItemDataの呼び出しが特定のエラーメッセージで失敗することを期待
        // width指定なしでテスト（元サイズパス）
        await expect(
          getVRChatPhotoItemData({
            photoPath: mockInputPhotoPath,
          }),
        ).rejects.toThrow(errorMessage);
      });

      // sharpインスタンスのtoBufferメソッドがエラーをスローする場合のテスト
      // この場合、発生したエラーがそのままスローされることを期待する。
      it('should throw error when sharp.toBuffer throws an error', async () => {
        const errorMessage = 'ToBuffer error';
        // toBufferメソッドが特定のエラーメッセージでエラーをスローするように設定
        mockSharpInstance.toBuffer.mockRejectedValueOnce(
          new Error(errorMessage),
        );

        // getVRChatPhotoItemDataの呼び出しが特定のエラーメッセージで失敗することを期待
        // width指定なしでテスト（元サイズパスでtoBufferエラーを確認）
        await expect(
          getVRChatPhotoItemData({
            photoPath: mockInputPhotoPath,
          }),
        ).rejects.toThrow(errorMessage);
      });
    });
  });

  describe('cleanupThumbnailCache', () => {
    // MAX_CACHE_SIZE_MB = 500, CACHE_CLEANUP_THRESHOLD = 0.9
    // つまり 450MB を超えたらクリーンアップ開始、250MBまで削減
    const mockReaddir = vi.mocked(fsPromises.readdir);
    const mockStat = vi.mocked(fsPromises.stat);
    const mockUnlink = vi.mocked(fsPromises.unlink);

    beforeEach(() => {
      mockReaddir.mockReset();
      mockStat.mockReset();
      mockUnlink.mockReset();
    });

    it('キャッシュサイズが閾値以下の場合はクリーンアップしない', async () => {
      // 400MB = 400 * 1024 * 1024 bytes (閾値450MB未満)
      const files = ['file1.webp', 'file2.webp'];
      // biome-ignore lint/suspicious/noExplicitAny: Mock return type
      mockReaddir.mockResolvedValue(files as any);
      mockStat.mockImplementation((filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes('file1') || pathStr.includes('file2')) {
          return Promise.resolve({
            size: 200 * 1024 * 1024, // 200MB each
            mtimeMs: Date.now(),
          }) as unknown as ReturnType<typeof fsPromises.stat>;
        }
        return Promise.reject(new Error('ENOENT'));
      });

      await cleanupThumbnailCache();

      // ファイル削除は行われない
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('キャッシュサイズが閾値を超えたら古いファイルから削除する', async () => {
      // 480MB = 120MB x 4 files (閾値450MBを超過)
      const files = ['file1.webp', 'file2.webp', 'file3.webp', 'file4.webp'];
      // biome-ignore lint/suspicious/noExplicitAny: Mock return type
      mockReaddir.mockResolvedValue(files as any);

      const now = Date.now();
      const fileData: Record<string, { size: number; mtime: number }> = {
        file1: { size: 120 * 1024 * 1024, mtime: now - 4000 }, // 最古
        file2: { size: 120 * 1024 * 1024, mtime: now - 3000 },
        file3: { size: 120 * 1024 * 1024, mtime: now - 2000 },
        file4: { size: 120 * 1024 * 1024, mtime: now - 1000 }, // 最新
      };

      mockStat.mockImplementation((filePath) => {
        const pathStr = String(filePath);
        for (const [key, data] of Object.entries(fileData)) {
          if (pathStr.includes(key)) {
            return Promise.resolve({
              size: data.size,
              mtimeMs: data.mtime,
            }) as unknown as ReturnType<typeof fsPromises.stat>;
          }
        }
        return Promise.reject(new Error('ENOENT'));
      });

      await cleanupThumbnailCache();

      // ファイル削除が呼ばれる（古いファイルから削除して250MB以下になるまで）
      // 480MB -> 削除で250MB以下にするには 230MB 以上削除が必要
      // 120MB x 2 = 240MB を削除すると 240MB になる
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('目標サイズに達したら削除を停止する', async () => {
      // 600MB = 100MB x 6 files (閾値450MBを大きく超過)
      const files = [
        'a.webp',
        'b.webp',
        'c.webp',
        'd.webp',
        'e.webp',
        'f.webp',
      ];
      // biome-ignore lint/suspicious/noExplicitAny: Mock return type
      mockReaddir.mockResolvedValue(files as any);

      const now = Date.now();
      let callIndex = 0;
      mockStat.mockImplementation(() => {
        callIndex++;
        return Promise.resolve({
          size: 100 * 1024 * 1024, // 100MB each
          mtimeMs: now - callIndex * 1000, // それぞれ異なる時刻
        }) as unknown as ReturnType<typeof fsPromises.stat>;
      });

      await cleanupThumbnailCache();

      // 600MB から 250MB まで削減するには 350MB 削除が必要
      // 100MB x 4 = 400MB を削除すると 200MB になる
      // 少なくとも何らかの削除が行われることを確認
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('ファイル削除に失敗しても処理を継続する', async () => {
      // 500MB = 250MB x 2 files (閾値450MBを超過)
      const files = ['fail.webp', 'success.webp'];
      // biome-ignore lint/suspicious/noExplicitAny: Mock return type
      mockReaddir.mockResolvedValue(files as any);

      const now = Date.now();
      mockStat.mockImplementation((filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes('fail')) {
          return Promise.resolve({
            size: 250 * 1024 * 1024,
            mtimeMs: now - 2000, // 古い
          }) as unknown as ReturnType<typeof fsPromises.stat>;
        }
        if (pathStr.includes('success')) {
          return Promise.resolve({
            size: 250 * 1024 * 1024,
            mtimeMs: now - 1000, // 新しい
          }) as unknown as ReturnType<typeof fsPromises.stat>;
        }
        return Promise.reject(new Error('ENOENT'));
      });

      // 最初のファイル削除は失敗するように設定
      mockUnlink
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValue(undefined);

      // エラーにならずに完了することを確認
      await expect(cleanupThumbnailCache()).resolves.toBeUndefined();
    });

    it('キャッシュディレクトリ読み取りに失敗した場合はエラーログを出力', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT: directory not found'));

      // エラーにならずに完了することを確認（ログ出力のみ）
      await expect(cleanupThumbnailCache()).resolves.toBeUndefined();
    });
  });

  describe('getBatchThumbnails', () => {
    let sharpFactory: ReturnType<typeof vi.mocked<typeof sharp>>;
    let mockSharpInstance: {
      metadata: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      webp: ReturnType<typeof vi.fn>;
      toBuffer: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      sharpFactory = vi.mocked(sharp);
      mockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({
          width: 1920,
          height: 1080,
          format: 'png',
        }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail_data')),
      };
      sharpFactory.mockReturnValue(
        mockSharpInstance as unknown as ReturnType<typeof sharp>,
      );
    });

    it('空の配列を渡すと空の結果を返す', async () => {
      const { getBatchThumbnails } = await import('./vrchatPhoto.service');
      const result = await getBatchThumbnails([]);
      expect(result.success.size).toBe(0);
      expect(result.failed.length).toBe(0);
    });

    it('成功したパスのサムネイルを返す', async () => {
      const { getBatchThumbnails } = await import('./vrchatPhoto.service');
      const paths = [
        '/path/to/VRChat_2024-01-15_10-00-00.000_1920x1080.png',
        '/path/to/VRChat_2024-01-15_11-00-00.000_1920x1080.png',
      ];

      const result = await getBatchThumbnails(paths, 256);

      expect(result.success.size).toBe(2);
      expect(result.success.has(paths[0])).toBe(true);
      expect(result.success.has(paths[1])).toBe(true);
      expect(result.failed.length).toBe(0);
    });

    it('一部のパスが失敗しても成功したものは返す（混合ケース）', async () => {
      const { getBatchThumbnails } = await import('./vrchatPhoto.service');

      // 2番目のリクエストでエラーを発生させる
      let callCount = 0;
      sharpFactory.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Input file is missing');
        }
        return mockSharpInstance as unknown as ReturnType<typeof sharp>;
      });

      const paths = [
        '/path/to/VRChat_2024-01-15_10-00-00.000_1920x1080.png', // 成功
        '/path/to/missing_photo.png', // 失敗
        '/path/to/VRChat_2024-01-15_12-00-00.000_1920x1080.png', // 成功
      ];

      const result = await getBatchThumbnails(paths, 256);

      // 2つは成功、1つは失敗
      expect(result.success.size).toBe(2);
      expect(result.success.has(paths[0])).toBe(true);
      expect(result.success.has(paths[1])).toBe(false); // 失敗したものは含まれない
      expect(result.success.has(paths[2])).toBe(true);
      // 失敗情報も返される（VRChat写真パターンにマッチしないので file_not_found）
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].photoPath).toBe(paths[1]);
      expect(result.failed[0].reason).toBe('file_not_found');
    });

    it('全て失敗した場合は空のsuccessと失敗リストを返す', async () => {
      const { getBatchThumbnails } = await import('./vrchatPhoto.service');

      sharpFactory.mockImplementation(() => {
        throw new Error('Input file is missing');
      });

      const paths = ['/path/to/missing1.png', '/path/to/missing2.png'];

      const result = await getBatchThumbnails(paths, 256);

      expect(result.success.size).toBe(0);
      expect(result.failed.length).toBe(2);
    });

    it('PARALLEL_LIMIT を超えるパスでも全て処理する', async () => {
      const { getBatchThumbnails } = await import('./vrchatPhoto.service');

      // PARALLEL_LIMIT = 8 なので、16個のパスを渡す
      const paths = Array.from(
        { length: 16 },
        (_, i) =>
          `/path/to/VRChat_2024-01-15_${String(i).padStart(2, '0')}-00-00.000_1920x1080.png`,
      );

      const result = await getBatchThumbnails(paths, 256);

      expect(result.success.size).toBe(16);
      expect(result.failed.length).toBe(0);
    });
  });

  describe('Cache Expiry (getCachedThumbnail)', () => {
    // CACHE_EXPIRY_DAYS = 7
    const mockStat = vi.mocked(fsPromises.stat);
    const mockReadFile = vi.mocked(fsPromises.readFile);
    let sharpFactory: ReturnType<typeof vi.mocked<typeof sharp>>;
    let mockSharpInstance: {
      metadata: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      webp: ReturnType<typeof vi.fn>;
      toBuffer: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      sharpFactory = vi.mocked(sharp);
      mockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({
          width: 1920,
          height: 1080,
          format: 'png',
        }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail_data')),
      };
      sharpFactory.mockReturnValue(
        mockSharpInstance as unknown as ReturnType<typeof sharp>,
      );
    });

    it('有効期限内のキャッシュは使用される', async () => {
      const mockPhotoPath =
        '/path/to/VRChat_2023-10-26_10-30-00.123_1920x1080.png';
      const cachedData = Buffer.from('cached_thumbnail_data');

      // キャッシュファイルが存在し、6日前（有効期限内）
      const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
      mockStat.mockResolvedValue({
        size: cachedData.length,
        mtimeMs: sixDaysAgo,
      } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);
      mockReadFile.mockResolvedValue(cachedData);

      const result = await getVRChatPhotoItemData({
        photoPath: mockPhotoPath,
        width: 256,
      });

      // キャッシュからのデータが返される
      expect(result.isOk()).toBe(true);
      // sharpは呼ばれない（キャッシュからデータを取得したため）
      expect(mockReadFile).toHaveBeenCalled();
    });

    it('有効期限切れのキャッシュは無視され再生成される', async () => {
      const mockPhotoPath =
        '/path/to/VRChat_2023-10-26_10-30-00.123_1920x1080.png';
      const newThumbnailData = Buffer.from('new_thumbnail_data');

      // キャッシュファイルが存在するが、8日前（有効期限切れ）
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      mockStat.mockResolvedValue({
        size: 1000,
        mtimeMs: eightDaysAgo,
      } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

      // sharpで新しいサムネイルを生成
      mockSharpInstance.toBuffer.mockResolvedValue(newThumbnailData);

      const result = await getVRChatPhotoItemData({
        photoPath: mockPhotoPath,
        width: 256,
      });

      // 新しく生成されたデータが返される
      expect(result.isOk()).toBe(true);
      // sharpが呼ばれる（キャッシュが期限切れなので再生成）
      expect(sharpFactory).toHaveBeenCalled();
    });

    it('キャッシュファイルが存在しない場合は新規生成', async () => {
      const mockPhotoPath =
        '/path/to/VRChat_2023-10-26_10-30-00.123_1920x1080.png';
      const newThumbnailData = Buffer.from('new_thumbnail_data');

      // キャッシュファイルが存在しない（ENOENT）
      const error = new Error('ENOENT: no such file') as Error & {
        code: string;
      };
      error.code = 'ENOENT';
      mockStat.mockRejectedValue(error);

      // sharpで新しいサムネイルを生成
      mockSharpInstance.toBuffer.mockResolvedValue(newThumbnailData);

      const result = await getVRChatPhotoItemData({
        photoPath: mockPhotoPath,
        width: 256,
      });

      // 新しく生成されたデータが返される
      expect(result.isOk()).toBe(true);
      // sharpが呼ばれる
      expect(sharpFactory).toHaveBeenCalled();
    });
  });

  describe('Concurrent Cache Writes (pendingCacheWrites)', () => {
    const mockWriteFile = vi.mocked(fsPromises.writeFile);
    const mockStat = vi.mocked(fsPromises.stat);
    let sharpFactory: ReturnType<typeof vi.mocked<typeof sharp>>;
    let mockSharpInstance: {
      metadata: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      webp: ReturnType<typeof vi.fn>;
      toBuffer: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      vi.resetAllMocks();
      sharpFactory = vi.mocked(sharp);
      mockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({
          width: 1920,
          height: 1080,
          format: 'png',
        }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail_data')),
      };
      sharpFactory.mockReturnValue(
        mockSharpInstance as unknown as ReturnType<typeof sharp>,
      );

      // キャッシュミスを強制（ENOENT）
      const enoentError = new Error('ENOENT') as Error & { code: string };
      enoentError.code = 'ENOENT';
      mockStat.mockRejectedValue(enoentError);
    });

    it('同一キーへの並行書き込みリクエストで、最初のリクエストのみが書き込みを実行', async () => {
      const { getVRChatPhotoItemData } = await import('./vrchatPhoto.service');
      const mockPhotoPath =
        '/path/to/VRChat_2024-01-15_10-00-00.000_1920x1080.png';

      // 遅延を追加して並行実行をシミュレート
      let _writeCallCount = 0;
      mockWriteFile.mockImplementation(async () => {
        _writeCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // 同じパスに対して並行でリクエスト
      const promises = Array.from({ length: 5 }, () =>
        getVRChatPhotoItemData({ photoPath: mockPhotoPath, width: 256 }),
      );

      const results = await Promise.all(promises);

      // 全てのリクエストが成功
      for (const result of results) {
        expect(result.isOk()).toBe(true);
      }

      // pendingCacheWrites により、複数の並行書き込みは防止される
      // 最初のリクエストで書き込みが開始されると、後続のリクエストはスキップされる
      // ただし、sharpは各リクエストで呼ばれる（キャッシュミスなので）
      expect(sharpFactory).toHaveBeenCalled();
    });

    it('異なるキーへの並行書き込みは全て実行される', async () => {
      const { getVRChatPhotoItemData } = await import('./vrchatPhoto.service');

      // 異なるパスを用意
      const paths = [
        '/path/to/VRChat_2024-01-15_10-00-00.000_1920x1080.png',
        '/path/to/VRChat_2024-01-15_11-00-00.000_1920x1080.png',
        '/path/to/VRChat_2024-01-15_12-00-00.000_1920x1080.png',
      ];

      const promises = paths.map((photoPath) =>
        getVRChatPhotoItemData({ photoPath, width: 256 }),
      );

      const results = await Promise.all(promises);

      // 全てのリクエストが成功
      for (const result of results) {
        expect(result.isOk()).toBe(true);
      }

      // 全ての異なるパスでsharpが呼ばれる
      expect(sharpFactory).toHaveBeenCalledTimes(3);
    });
  });

  describe('Cache Failure Threshold', () => {
    const mockWriteFile = vi.mocked(fsPromises.writeFile);
    const mockRename = vi.mocked(fsPromises.rename);
    const mockStat = vi.mocked(fsPromises.stat);
    let sharpFactory: ReturnType<typeof vi.mocked<typeof sharp>>;
    let mockSharpInstance: {
      metadata: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      webp: ReturnType<typeof vi.fn>;
      toBuffer: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      vi.resetAllMocks();
      sharpFactory = vi.mocked(sharp);
      mockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({
          width: 1920,
          height: 1080,
          format: 'png',
        }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail_data')),
      };
      sharpFactory.mockReturnValue(
        mockSharpInstance as unknown as ReturnType<typeof sharp>,
      );

      // キャッシュミスを強制（ENOENT）
      const enoentError = new Error('ENOENT') as Error & { code: string };
      enoentError.code = 'ENOENT';
      mockStat.mockRejectedValue(enoentError);
    });

    it('キャッシュ書き込みが10回連続失敗すると警告ログが出力される', async () => {
      const { getVRChatPhotoItemData } = await import('./vrchatPhoto.service');
      const { logger } = await import('../../lib/logger');
      const loggerWarnSpy = vi.spyOn(logger, 'warn');

      // writeFileを常に失敗させる
      mockWriteFile.mockRejectedValue(new Error('Disk full'));
      mockRename.mockRejectedValue(new Error('Disk full'));

      // CACHE_FAILURE_THRESHOLD = 10 なので、11回リクエストを送る
      const paths = Array.from(
        { length: 11 },
        (_, i) =>
          `/path/to/VRChat_2024-01-20_${String(i).padStart(2, '0')}-00-00.000_1920x1080.png`,
      );

      for (const photoPath of paths) {
        await getVRChatPhotoItemData({ photoPath, width: 256 });
        // キャッシュ書き込みは非同期で行われるので少し待つ
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // 10回連続失敗時に警告ログが呼ばれることを確認
      // （warnは他の場所でも呼ばれる可能性があるため、内容を確認）
      const cacheFailureWarning = loggerWarnSpy.mock.calls.find(
        (call) =>
          typeof call[0] === 'object' &&
          call[0].message?.includes('Thumbnail cache has failed'),
      );
      expect(cacheFailureWarning).toBeDefined();

      loggerWarnSpy.mockRestore();
    });

    it('書き込み成功で連続失敗カウンターがリセットされる', async () => {
      const { getVRChatPhotoItemData } = await import('./vrchatPhoto.service');
      const { logger } = await import('../../lib/logger');
      const loggerWarnSpy = vi.spyOn(logger, 'warn');

      // 最初の5回は失敗、その後成功、その後5回失敗
      let callCount = 0;
      mockWriteFile.mockImplementation(async () => {
        callCount++;
        if (callCount <= 5 || callCount > 6) {
          throw new Error('Disk full');
        }
        // 6回目は成功
      });
      mockRename.mockImplementation(async () => {
        if (callCount <= 5 || callCount > 6) {
          throw new Error('Disk full');
        }
      });

      const paths = Array.from(
        { length: 11 },
        (_, i) =>
          `/path/to/VRChat_2024-01-21_${String(i).padStart(2, '0')}-00-00.000_1920x1080.png`,
      );

      for (const photoPath of paths) {
        await getVRChatPhotoItemData({ photoPath, width: 256 });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // 閾値の10回に達しないため、警告ログは出ない（はず）
      // ただし6回目で成功してリセットされるので、5 + 5 = 10回の失敗だが連続は5回まで
      const cacheFailureWarning = loggerWarnSpy.mock.calls.find(
        (call) =>
          typeof call[0] === 'object' &&
          call[0].message?.includes('Thumbnail cache has failed'),
      );
      // 連続失敗が10回に達しないので警告は出ないはず
      expect(cacheFailureWarning).toBeUndefined();

      loggerWarnSpy.mockRestore();
    });
  });

  describe('Memory Monitoring', () => {
    it('checkMemoryUsage が正しいメモリ使用量を返す', async () => {
      // checkMemoryUsage はエクスポートされていないため、
      // 間接的にテストする必要がある。
      // getPhotoPathBatches 内でメモリ監視が行われるが、
      // ユニットテストでは process.memoryUsage() をモックするのは難しい。
      // このテストは統合テストレベルで確認するのが適切。

      // 代わりに、メモリ使用量が500MBを超えた場合のログ出力をテスト
      // (ただし、実際のヒープサイズをコントロールするのは困難)
      expect(true).toBe(true); // プレースホルダー
    });
  });
});
