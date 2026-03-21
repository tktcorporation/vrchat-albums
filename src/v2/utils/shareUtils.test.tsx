import { describe, expect, it, vi } from 'vitest';
import { downloadOrCopyImageAsPng } from './shareUtils';

describe('shareUtils', () => {
  describe('downloadOrCopyImageAsPng', () => {
    it('should call mutation with correct params', async () => {
      const copyImageMutation = vi.fn().mockResolvedValue(undefined);

      await downloadOrCopyImageAsPng({
        pngBase64: 'test-base64',
        filenameWithoutExt: 'test',
        downloadOrCopyMutation: {
          mutateAsync: copyImageMutation,
        },
      });

      expect(copyImageMutation).toHaveBeenCalledWith({
        filenameWithoutExt: 'test',
        pngBase64: 'test-base64',
      });
    });

    it('should handle null PNG base64 data', async () => {
      const copyImageMutation = vi.fn().mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, 'error');

      await expect(
        downloadOrCopyImageAsPng({
          pngBase64: undefined as unknown as string,
          filenameWithoutExt: 'test',
          downloadOrCopyMutation: {
            mutateAsync: copyImageMutation,
          },
        }),
      ).rejects.toThrow('Failed to convert to PNG');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to convert to PNG:',
        'No PNG base64 data',
      );
    });

    it('should handle mutation error', async () => {
      const error = new Error('Failed to copy image');
      const copyImageMutation = vi.fn().mockRejectedValue(error);
      const consoleSpy = vi.spyOn(console, 'error');

      await expect(
        downloadOrCopyImageAsPng({
          pngBase64: 'test-base64',
          filenameWithoutExt: 'test',
          downloadOrCopyMutation: {
            mutateAsync: copyImageMutation,
          },
        }),
      ).rejects.toThrow('Failed to convert to PNG');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to convert to PNG:',
        error,
      );
    });
  });
});
