import sharp, { type Metadata, type Sharp } from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getVRChatPhotoItemData } from './vrchatPhoto.service';

// node:fs/promisesをモック（キャッシュ機能で使用）
vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')), // キャッシュなし
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  unlink: vi.fn().mockResolvedValue(undefined),
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
});
