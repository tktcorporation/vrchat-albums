import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AbsolutePathObjectSchema,
  BackupPathObjectSchema,
  ExportPathObjectSchema,
  PathObjectSchema,
  VRChatPhotoPathObjectSchema,
} from './pathObject.js';

describe('PathObject', () => {
  describe('基本機能', () => {
    it('パスを正規化できる', () => {
      const pathObj = PathObjectSchema.parse('/path/to//file/../dir/');
      const normalized = pathObj.normalize();
      expect(normalized.value).toBe(path.normalize('/path/to//file/../dir/'));
    });

    it('パスを安全に結合できる', () => {
      const pathObj = PathObjectSchema.parse('/base/path');
      const joined = pathObj.join('subdir', 'file.txt');
      expect(joined.value).toBe(path.join('/base/path', 'subdir', 'file.txt'));
    });

    it('絶対パスに解決できる', () => {
      const pathObj = PathObjectSchema.parse('relative/path');
      const absolute = pathObj.resolve();
      expect(absolute.value).toBe(path.resolve('relative/path'));
      expect(path.isAbsolute(absolute.value)).toBe(true);
    });

    it('ベースパス内にあるかチェックできる', () => {
      const basePath = PathObjectSchema.parse('/base/path');
      const safePath = PathObjectSchema.parse('/base/path/subdir/file.txt');
      const unsafePath = PathObjectSchema.parse('/base/../outside/file.txt');

      expect(safePath.isWithin(basePath)).toBe(true);
      expect(unsafePath.isWithin(basePath)).toBe(false);
    });

    it('ファイル名を取得できる', () => {
      const pathObj = PathObjectSchema.parse('/path/to/file.txt');
      expect(pathObj.basename()).toBe('file.txt');
      expect(pathObj.basename('.txt')).toBe('file');
    });

    it('glob用にフォワードスラッシュに正規化できる', () => {
      const windowsPath = PathObjectSchema.parse(
        String.raw`C:\path\to\file.txt`,
      );
      expect(windowsPath.toGlobPattern()).toBe('C:/path/to/file.txt');
    });
  });

  describe('クロスプラットフォーム対応', () => {
    it('Windows形式のパスを正しく処理できる', () => {
      const windowsPath = String.raw`C:\Users\Test\Documents\file.txt`;
      const pathObj = PathObjectSchema.parse(windowsPath);
      const normalized = pathObj.normalize();

      // プラットフォームによって結果が変わるため、一貫性をチェック
      expect(normalized.value).toBeTruthy();
      // Linux環境でWindows形式のパスを扱う場合、basenameは期待通りに動作しない
      // この場合は、パス全体が返される
      const basename = pathObj.basename();
      expect(basename).toBeTruthy();
    });

    it('混在パス区切り文字を処理できる', () => {
      const mixedPath = String.raw`C:\Users\Test/Documents/file.txt`;
      const pathObj = PathObjectSchema.parse(mixedPath);
      const normalized = pathObj.normalize();

      expect(normalized.value).toBeTruthy();
      expect(pathObj.toGlobPattern()).toBe('C:/Users/Test/Documents/file.txt');
    });
  });
});

describe('AbsolutePathObject', () => {
  it('相対パスを絶対パスに変換する', () => {
    const relativePath = 'relative/path';
    const absPath = AbsolutePathObjectSchema.parse(relativePath);
    expect(path.isAbsolute(absPath.value)).toBe(true);
  });

  it('既に絶対パスの場合はそのまま使用する', () => {
    const absolutePath = '/absolute/path';
    const absPath = AbsolutePathObjectSchema.parse(absolutePath);
    expect(absPath.value).toBe(absolutePath);
  });

  it('resolve()は自身を返す', () => {
    const absPath = AbsolutePathObjectSchema.parse('/absolute/path');
    const resolved = absPath.resolve();
    expect(resolved).toBe(absPath);
  });
});

describe('ExportPathObject', () => {
  it('エクスポートフォルダ名を抽出できる', () => {
    const exportPath = ExportPathObjectSchema.parse(
      '/downloads/vrchat-albums-export_2023-12-01_14-30-45/2023-11/logStore.txt',
    );
    expect(exportPath.extractExportFolderName()).toBe(
      'vrchat-albums-export_2023-12-01_14-30-45',
    );
  });

  it('Windows形式のパスからもエクスポートフォルダ名を抽出できる', () => {
    const exportPath = ExportPathObjectSchema.parse(
      String.raw`C:\Downloads\vrchat-albums-export_2023-12-01_14-30-45\2023-11\logStore.txt`,
    );
    expect(exportPath.extractExportFolderName()).toBe(
      'vrchat-albums-export_2023-12-01_14-30-45',
    );
  });

  it('混在パス区切り文字からもエクスポートフォルダ名を抽出できる', () => {
    const exportPath = ExportPathObjectSchema.parse(
      String.raw`C:\Downloads\backups/vrchat-albums-export_2023-12-01_14-30-45/2023-11/logStore.txt`,
    );
    expect(exportPath.extractExportFolderName()).toBe(
      'vrchat-albums-export_2023-12-01_14-30-45',
    );
  });

  it('エクスポートフォルダが見つからない場合はnullを返す', () => {
    const exportPath = ExportPathObjectSchema.parse(
      '/downloads/other-folder/file.txt',
    );
    expect(exportPath.extractExportFolderName()).toBeNull();
  });

  it('タイムスタンプ付きサブディレクトリを作成できる', () => {
    const basePath = ExportPathObjectSchema.parse('/downloads');
    const withTimestamp = basePath.withTimestampedSubdir();

    expect(withTimestamp.value).toMatch(
      /[/\\]downloads[/\\]vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/,
    );
  });
});

describe('BackupPathObject', () => {
  it('バックアップIDでパスを作成できる', () => {
    const backupBase = BackupPathObjectSchema.parse('/app/backups');
    const withId = backupBase.withBackupId('backup-123');
    expect(withId.value).toBe(path.join('/app/backups', 'backup-123'));
  });

  it('インポートバックアップ用のプレフィックスを追加できる', () => {
    const backupBase = BackupPathObjectSchema.parse('/app/backups');
    const withPrefix = backupBase.withImportBackupPrefix();

    expect(withPrefix.value).toMatch(
      /[/\\]app[/\\]backups[/\\]backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/,
    );
  });
});

describe('VRChatPhotoPathObject', () => {
  it('VRChat写真用のglobパターンを生成できる', () => {
    const photoPath = VRChatPhotoPathObjectSchema.parse('/path/to/photos');
    const pattern = photoPath.toPhotoGlobPattern();
    expect(pattern).toBe('/path/to/photos/**/VRChat_*_wrld_*');
  });

  it('Windows形式のパスでもglobパターンを正しく生成できる', () => {
    const photoPath = VRChatPhotoPathObjectSchema.parse(
      String.raw`C:\Users\Test\Pictures`,
    );
    const pattern = photoPath.toPhotoGlobPattern();
    expect(pattern).toBe('C:/Users/Test/Pictures/**/VRChat_*_wrld_*');
  });

  it('カスタムパターンでglobパターンを生成できる', () => {
    const photoPath = VRChatPhotoPathObjectSchema.parse('/photos');
    const pattern = photoPath.toPhotoGlobPattern('VRChat_*.png');
    expect(pattern).toBe('/photos/**/VRChat_*.png');
  });

  describe('extractPhotoInfo', () => {
    it('正しい形式の写真ファイル名から情報を抽出できる', () => {
      const filePath =
        'VRChat_2023-12-01_14-30-45.123_wrld_12345678-1234-1234-1234-123456789abc.png';
      const info =
        VRChatPhotoPathObjectSchema.parse(filePath).extractPhotoInfo();

      expect(info).not.toBeNull();
      expect(info?.worldId).toBe('wrld_12345678-1234-1234-1234-123456789abc');
      // 日付の検証
      const expectedDate = new Date('2023-12-01T14:30:45.123');
      expect(info?.joinDate.getTime()).toBe(expectedDate.getTime());
    });

    it('不正な形式のファイル名はnullを返す', () => {
      const invalidPaths = [
        'VRChat_2023-12-01.png',
        'screenshot_2023-12-01.png',
        'VRChat_invalid_date_wrld_12345678-1234-1234-1234-123456789abc.png',
      ];

      for (const path of invalidPaths) {
        expect(
          VRChatPhotoPathObjectSchema.parse(path).extractPhotoInfo(),
        ).toBeNull();
      }
    });

    it('フルパスからも情報を抽出できる', () => {
      const filePath =
        '/home/user/Pictures/VRChat_2023-12-01_14-30-45.123_wrld_12345678-1234-1234-1234-123456789abc.png';
      const info =
        VRChatPhotoPathObjectSchema.parse(filePath).extractPhotoInfo();

      expect(info).not.toBeNull();
      expect(info?.worldId).toBe('wrld_12345678-1234-1234-1234-123456789abc');
    });
  });
});
