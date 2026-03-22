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
    throw new Error('Failed to convert to PNG: No PNG base64 data');
  }

  // effect-lint-allow-try-catch: React フロントエンド境界
  try {
    await downloadOrCopyMutation.mutateAsync({
      pngBase64,
      filenameWithoutExt,
    });
  } catch (error) {
    throw new Error('Failed to convert to PNG', { cause: error });
  }
};
