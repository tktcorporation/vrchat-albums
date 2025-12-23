import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { dialog } from 'electron';
import * as path from 'pathe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { electronUtilRouter } from '../electronUtilController';

// パスの正規化のためのヘルパー関数を追加
const normalizePath = (p: string) => p.replace(/\\/g, '/');

vi.mock('node:fs/promises');
vi.mock('electron-is-dev', () => ({ default: false }));
vi.mock('electron', () => ({
  clipboard: {
    writeText: vi.fn(),
    writeImage: vi.fn(),
  },
  nativeImage: {
    createFromPath: vi.fn(),
    createFromBuffer: vi.fn(),
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));

describe('electronUtilController', () => {
  const router = electronUtilRouter();

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.mkdtemp as ReturnType<typeof vi.fn>).mockResolvedValue(
      path.join(os.tmpdir(), 'test-dir'),
    );
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.copyFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.rm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  describe('downloadImageAsPng', () => {
    it('should download image as png', async () => {
      const mockPath = path.join(os.homedir(), 'Downloads', 'test.png');
      (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        filePath: mockPath,
      });

      await router.downloadImageAsPng({
        ctx: {} as unknown,
        input: {
          pngBase64: 'test-base64',
          filenameWithoutExt: 'test',
        },
        path: '',
        type: 'mutation',
        getRawInput: async () => ({
          pngBase64: 'test-base64',
          filenameWithoutExt: 'test',
        }),
        signal: new AbortController().signal,
      });

      const expectedTempPath = path.join(os.tmpdir(), 'test-dir', 'test.png');

      // 一時ファイルの作成を確認
      const writeFilePath = vi.mocked(fs.writeFile).mock.calls[0][0];
      expect(normalizePath(writeFilePath.toString())).toBe(
        normalizePath(expectedTempPath),
      );
      expect(vi.mocked(fs.writeFile).mock.calls[0][1]).toBeInstanceOf(
        Uint8Array,
      );

      // 一時ファイルから保存先へのコピーを確認
      const copyFileSrcPath = vi.mocked(fs.copyFile).mock.calls[0][0];
      const copyFileDestPath = vi.mocked(fs.copyFile).mock.calls[0][1];
      expect(normalizePath(copyFileSrcPath.toString())).toBe(
        normalizePath(expectedTempPath),
      );
      expect(normalizePath(copyFileDestPath.toString())).toBe(
        normalizePath(mockPath),
      );

      // 一時ディレクトリの削除を確認
      expect(fs.rm).toHaveBeenCalledWith(path.join(os.tmpdir(), 'test-dir'), {
        recursive: true,
        force: true,
      });
    });

    it('should handle dialog cancel', async () => {
      (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: true,
      });

      await router.downloadImageAsPng({
        ctx: {} as unknown,
        input: {
          pngBase64: 'test-base64',
          filenameWithoutExt: 'test',
        },
        path: '',
        type: 'mutation',
        getRawInput: async () => ({
          pngBase64: 'test-base64',
          filenameWithoutExt: 'test',
        }),
        signal: new AbortController().signal,
      });

      // 一時ファイルの作成は行われる
      expect(fs.writeFile).toHaveBeenCalled();
      // コピーは行われない
      expect(fs.copyFile).not.toHaveBeenCalled();
      // 一時ディレクトリは削除される
      expect(fs.rm).toHaveBeenCalledWith(path.join(os.tmpdir(), 'test-dir'), {
        recursive: true,
        force: true,
      });
    });

    it('should handle write error', async () => {
      const mockPath = path.join(os.homedir(), 'Downloads', 'test.png');
      (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        filePath: mockPath,
      });
      const mockError = new Error('Write error');
      (fs.copyFile as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);

      await expect(
        router.downloadImageAsPng({
          ctx: {} as unknown,
          input: {
            pngBase64: 'test-base64',
            filenameWithoutExt: 'test',
          },
          path: '',
          type: 'mutation',
          getRawInput: async () => ({
            pngBase64: 'test-base64',
            filenameWithoutExt: 'test',
          }),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('ファイル操作中にエラーが発生しました。');

      // エラー後も一時ディレクトリは削除される
      expect(fs.rm).toHaveBeenCalledWith(path.join(os.tmpdir(), 'test-dir'), {
        recursive: true,
        force: true,
      });
    });
  });
});
