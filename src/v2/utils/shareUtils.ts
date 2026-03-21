interface ShareImageOptions {
  pngBase64: string;
  filenameWithoutExt: string;
  downloadOrCopyMutation: {
    mutateAsync: (params: {
      pngBase64: string;
      filenameWithoutExt: string;
    }) => Promise<void>;
  };
}

/**
 * 画像をPNGとしてダウンロードまたはクリップボードにコピーするための処理
 */
export const downloadOrCopyImageAsPng = async ({
  pngBase64,
  filenameWithoutExt,
  downloadOrCopyMutation,
}: ShareImageOptions): Promise<void> => {
  if (!pngBase64) {
    console.error('Failed to convert to PNG:', 'No PNG base64 data');
    throw new Error('Failed to convert to PNG');
  }

  try {
    await downloadOrCopyMutation.mutateAsync({
      pngBase64,
      filenameWithoutExt,
    });
  } catch (error) {
    console.error('Failed to convert to PNG:', error);
    throw new Error('Failed to convert to PNG');
  }
};
