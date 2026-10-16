import * as fs from 'node:fs/promises';
import * as os from 'node:os';

import { Effect } from 'effect';
import * as path from 'pathe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { eventEmitter } from '../../../../trpc';
import { electronUtilRouter } from '../electronUtilController';

const normalizePath = (p: string) => p.replaceAll('\\', '/');

vi.mock('node:fs/promises');

const mockElectron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));

const mockExifTool = vi.hoisted(() => ({
  writeDateTimeWithTimezone: vi.fn(),
}));

vi.mock('electron', () => mockElectron);
vi.mock('../../../../lib/electronModules', () => ({
  getApp: () => mockElectron.app,
  getShell: () => ({}),
  getDialog: () => mockElectron.dialog,
  getClipboard: () => ({}),
  getClipboardItem: () => class {},
  getNativeImage: () => ({}),
}));
vi.mock('../../../../lib/wrappedExifTool', () => mockExifTool);

const tempDir = path.join(os.tmpdir(), 'test-dir');
const joinDateTime = new Date(2024, 7, 15, 21, 30, 5, 123);
const filename = 'VRChat_2024-08-15_21-30-05.123_wrld_test';
const input = {
  worldId: 'wrld_test',
  joinDateTime,
  imageBase64: 'test-base64',
};

const callDownload = () =>
  electronUtilRouter().downloadImageAsPhotoLogPng({
    ctx: {} as unknown,
    input,
    path: '',
    type: 'mutation',
    getRawInput: async () => input,
    signal: new AbortController().signal,
    batchIndex: 0,
  });

describe('electronUtilController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdtemp).mockResolvedValue(tempDir);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    mockExifTool.writeDateTimeWithTimezone.mockReturnValue(Effect.void);
    vi.spyOn(eventEmitter, 'emit');
  });

  describe('downloadImageAsPhotoLogPng', () => {
    it('一時ファイルに EXIF を書き込み、選ばれた保存先へコピーする', async () => {
      const savePath = path.join(os.homedir(), 'Downloads', `${filename}.png`);
      mockElectron.dialog.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: savePath,
      });

      await callDownload();

      const expectedTempPath = path.join(tempDir, `${filename}.png`);
      const [writePath, writeData] = vi.mocked(fs.writeFile).mock.calls[0];
      expect(normalizePath(writePath.toString())).toBe(
        normalizePath(expectedTempPath),
      );
      expect(writeData).toBeInstanceOf(Uint8Array);

      expect(mockExifTool.writeDateTimeWithTimezone).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'wrld_test',
          dateTimeOriginal: '2024-08-15 21:30:05',
        }),
      );

      const [copySrc, copyDest] = vi.mocked(fs.copyFile).mock.calls[0];
      expect(normalizePath(copySrc.toString())).toBe(
        normalizePath(expectedTempPath),
      );
      expect(normalizePath(copyDest.toString())).toBe(normalizePath(savePath));
      expect(
        mockExifTool.writeDateTimeWithTimezone.mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(fs.copyFile).mock.invocationCallOrder[0]);
      expect(eventEmitter.emit).toHaveBeenCalledWith('toast', 'downloaded');

      expect(fs.rm).toHaveBeenCalledWith(tempDir, {
        recursive: true,
        force: true,
      });
    });

    it('保存ダイアログをキャンセルしたらコピーせず一時ディレクトリを消す', async () => {
      mockElectron.dialog.showSaveDialog.mockResolvedValue({ canceled: true });

      await callDownload();

      expect(fs.writeFile).toHaveBeenCalledOnce();
      expect(mockExifTool.writeDateTimeWithTimezone).not.toHaveBeenCalled();
      expect(fs.copyFile).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('toast', 'downloaded');
      expect(fs.rm).toHaveBeenCalledWith(tempDir, {
        recursive: true,
        force: true,
      });
    });

    it('保存先へのコピーに失敗しても一時ディレクトリを消して失敗を返す', async () => {
      mockElectron.dialog.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: path.join(os.homedir(), 'Downloads', `${filename}.png`),
      });
      vi.mocked(fs.copyFile).mockRejectedValue(new Error('Write error'));

      await expect(callDownload()).rejects.toThrow('Write error');

      expect(fs.copyFile).toHaveBeenCalledOnce();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('toast', 'downloaded');

      expect(fs.rm).toHaveBeenCalledWith(tempDir, {
        recursive: true,
        force: true,
      });
    });
  });
});
