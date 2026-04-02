import { describe, expect, it, vi } from 'vitest';

import { downloadOrCopyImageAsPng } from './shareUtils';

describe('shareUtils', () => {
  describe('downloadOrCopyImageAsPng', () => {
    it('should call mutation with correct params', async () => {
      const copyImageMutation = vi.fn().mockResolvedValue();

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
      const copyImageMutation = vi.fn().mockResolvedValue();

      await expect(
        downloadOrCopyImageAsPng({
          pngBase64: undefined as unknown as string,
          filenameWithoutExt: 'test',
          downloadOrCopyMutation: {
            mutateAsync: copyImageMutation,
          },
        }),
      ).rejects.toThrow('Failed to convert to PNG: No PNG base64 data');
    });

    it('should preserve original error as cause when mutation fails', async () => {
      const originalError = new Error('Failed to copy image');
      const copyImageMutation = vi.fn().mockRejectedValue(originalError);

      let thrownError: Error | undefined;
      try {
        await downloadOrCopyImageAsPng({
          pngBase64: 'test-base64',
          filenameWithoutExt: 'test',
          downloadOrCopyMutation: {
            mutateAsync: copyImageMutation,
          },
        });
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError?.message).toBe('Failed to convert to PNG');
      expect(thrownError?.cause).toBe(originalError);
    });
  });
});
