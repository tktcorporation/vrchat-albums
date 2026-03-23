import { describe, expect, it } from 'vitest';

describe('VRChat Photo Service cross-platform path handling', () => {
  describe('normalizePathForGlob', () => {
    // Helper function that mimics the path normalization in vrchatPhoto.service.ts
    const normalizePathForGlob = (targetDir: string): string => {
      // Convert to POSIX format for glob pattern matching
      // glob always expects forward slashes regardless of platform
      return targetDir.replaceAll('\\', '/');
    };

    it('should convert Windows paths to POSIX format', () => {
      expect(
        normalizePathForGlob(String.raw`C:\Users\user\Pictures\VRChat`),
      ).toBe('C:/Users/user/Pictures/VRChat');
      expect(normalizePathForGlob(String.raw`D:\Photos\VRChat\2024`)).toBe(
        'D:/Photos/VRChat/2024',
      );
    });

    it('should leave Unix paths unchanged', () => {
      expect(normalizePathForGlob('/home/user/Pictures/VRChat')).toBe(
        '/home/user/Pictures/VRChat',
      );
      expect(normalizePathForGlob('/usr/local/photos')).toBe(
        '/usr/local/photos',
      );
    });

    it('should handle mixed separators', () => {
      expect(
        normalizePathForGlob(String.raw`C:\Users/user\Pictures/VRChat\2024`),
      ).toBe('C:/Users/user/Pictures/VRChat/2024');
    });

    it('should handle UNC paths', () => {
      expect(
        normalizePathForGlob(String.raw`\\server\share\Photos\VRChat`),
      ).toBe('//server/share/Photos/VRChat');
    });

    it('should handle paths with spaces', () => {
      expect(
        normalizePathForGlob(String.raw`C:\Program Files\VRChat Photos\2024`),
      ).toBe('C:/Program Files/VRChat Photos/2024');
    });

    it('should handle trailing separators', () => {
      expect(normalizePathForGlob('C:\\Users\\user\\Pictures\\')).toBe(
        'C:/Users/user/Pictures/',
      );
      expect(normalizePathForGlob('/home/user/pictures/')).toBe(
        '/home/user/pictures/',
      );
    });
  });

  describe('extractFolderFromPath', () => {
    // Helper function that mimics the folder extraction in backupService.ts
    const extractFolderFromPath = (
      filePath: string,
      prefix: string,
    ): string | null => {
      // Cross-platform: split by both forward slashes and backslashes
      const parts = filePath.split(/[/\\]/);
      const folderIndex = parts.findIndex((part) => part.startsWith(prefix));

      if (folderIndex === -1) {
        return null;
      }

      return parts[folderIndex];
    };

    it('should extract folder from Unix paths', () => {
      const path =
        '/path/to/backups/vrchat-albums-export_2023-12-01_14-30-45/2023-11/logStore-2023-11.txt';
      expect(extractFolderFromPath(path, 'vrchat-albums-export_')).toBe(
        'vrchat-albums-export_2023-12-01_14-30-45',
      );
    });

    it('should extract folder from Windows paths', () => {
      const path = String.raw`C:\backups\vrchat-albums-export_2023-12-01_14-30-45\2023-11\logStore-2023-11.txt`;
      expect(extractFolderFromPath(path, 'vrchat-albums-export_')).toBe(
        'vrchat-albums-export_2023-12-01_14-30-45',
      );
    });

    it('should handle mixed separators', () => {
      const path = String.raw`C:\backups/vrchat-albums-export_2023-12-01_14-30-45\2023-11/logStore-2023-11.txt`;
      expect(extractFolderFromPath(path, 'vrchat-albums-export_')).toBe(
        'vrchat-albums-export_2023-12-01_14-30-45',
      );
    });

    it('should return null when folder not found', () => {
      const path = '/path/to/backups/some-other-folder/file.txt';
      expect(extractFolderFromPath(path, 'vrchat-albums-export_')).toBe(null);
    });
  });
});
