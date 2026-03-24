import { describe, expect, it } from 'vitest';

// Helper function from DataImport.tsx
const getFilenameFromPath = (filePath: string): string => {
  // Split by both forward slashes and backslashes
  const parts = filePath.split(/[/\\]/);
  const filename = parts.at(-1);
  // If filename is empty (path ends with separator), try the second to last part
  return filename || parts.at(-2) || filePath;
};

describe('DataImport cross-platform path handling', () => {
  describe('getFilenameFromPath', () => {
    it('should extract filename from Unix paths', () => {
      expect(getFilenameFromPath('/home/user/documents/file.txt')).toBe(
        'file.txt',
      );
      expect(getFilenameFromPath('/usr/local/bin/app')).toBe('app');
      expect(getFilenameFromPath('/file.txt')).toBe('file.txt');
    });

    it('should extract filename from Windows paths', () => {
      expect(
        getFilenameFromPath(String.raw`C:\Users\user\Documents\file.txt`),
      ).toBe('file.txt');
      expect(getFilenameFromPath(String.raw`D:\Program Files\app.exe`)).toBe(
        'app.exe',
      );
      expect(getFilenameFromPath(String.raw`C:\file.txt`)).toBe('file.txt');
    });

    it('should handle mixed path separators', () => {
      expect(
        getFilenameFromPath(String.raw`C:\Users/user/Documents\file.txt`),
      ).toBe('file.txt');
      expect(
        getFilenameFromPath(String.raw`/home\user/documents\file.txt`),
      ).toBe('file.txt');
    });

    it('should handle edge cases', () => {
      expect(getFilenameFromPath('file.txt')).toBe('file.txt');
      expect(getFilenameFromPath('')).toBe('');
      // When path is only a separator, it falls back to the original path
      expect(getFilenameFromPath('/')).toBe('/');
      expect(getFilenameFromPath('\\')).toBe('\\');
    });

    it('should handle paths with multiple dots', () => {
      expect(getFilenameFromPath('/path/to/file.name.with.dots.txt')).toBe(
        'file.name.with.dots.txt',
      );
      expect(
        getFilenameFromPath(String.raw`C:\path\to\file.name.with.dots.txt`),
      ).toBe('file.name.with.dots.txt');
    });

    it('should handle directory paths', () => {
      // When path ends with separator, it extracts the directory name
      expect(getFilenameFromPath('/home/user/documents/')).toBe('documents');
      expect(getFilenameFromPath('C:\\Users\\user\\Documents\\')).toBe(
        'Documents',
      );
    });
  });
});
