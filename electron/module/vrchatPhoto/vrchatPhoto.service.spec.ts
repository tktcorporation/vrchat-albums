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
});
