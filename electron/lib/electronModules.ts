/**
 * Electron/Electrobun モジュールの互換レイヤー。
 *
 * 背景: 元々は Electron の遅延 require ヘルパーだった。
 * Electrobun 移行後は electrobunCompat モジュールに委譲する。
 * 各 service/controller から利用されるインターフェースを維持。
 *
 * 参照: .claude/rules/electron-import.md
 * 不要になれば: electrobunCompat を直接利用するよう各呼び出し元を修正して削除可能
 */
import * as compat from './electrobunCompat';

/**
 * Electrobun の app 互換オブジェクト。
 * Electron の app モジュールの代替。
 */
export const getApp = () => ({
  getPath: compat.getPath,
  isPackaged: compat.isPackaged(),
  quit: compat.quit,
  name: 'VRChatAlbums',
  /**
   * ログイン時起動設定の取得（Electrobun 未対応スタブ）。
   * TODO: Electrobun の自動起動 API が提供された場合に実装
   */
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setLoginItemSettings: (_settings: {
    openAtLogin: boolean;
    openAsHidden?: boolean;
  }) => {
    console.warn(
      '[electrobunCompat] setLoginItemSettings is not supported in Electrobun',
    );
  },
});

/**
 * Electrobun の shell 互換オブジェクト。
 */
export const getShell = () => ({
  openExternal: compat.openExternal,
  openPath: compat.openPath,
  showItemInFolder: compat.showItemInFolder,
});

/**
 * Electrobun の dialog 互換オブジェクト。
 * showOpenDialog と showSaveDialog の両方を提供する。
 */
export const getDialog = () => ({
  showOpenDialog: compat.showOpenDialog,
  /**
   * ファイル保存ダイアログ。
   * Electrobun には直接の API がないため、ファイル選択ダイアログで代替。
   * TODO: Electrobun の save dialog API が提供された場合に更新
   */
  showSaveDialog: async (options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }> => {
    try {
      const result = await compat.showOpenDialog({
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      // ディレクトリ選択 + デフォルトファイル名で保存先を構築
      const defaultName = options.defaultPath
        ? (options.defaultPath.split('/').pop() ?? 'file')
        : 'file';
      const filePath = `${result.filePaths[0]}/${defaultName}`;
      return { canceled: false, filePath };
    } catch {
      return { canceled: true };
    }
  },
});

/**
 * Electrobun の clipboard 互換オブジェクト。
 * writeImage は Electrobun 未対応のため no-op スタブ。
 */
export const getClipboard = () => ({
  ...compat.clipboard,
  // Electrobun では nativeImage ベースのクリップボード書き込みは未対応
  // TODO: Electrobun のクリップボード画像 API が提供された場合に実装
  writeImage: (_image: unknown): void => {
    console.warn(
      '[electrobunCompat] clipboard.writeImage is not supported in Electrobun',
    );
  },
});

/**
 * nativeImage は Electrobun では直接サポートされないため、
 * スタブを返す。画像操作は @napi-rs/image で行う。
 */
export const getNativeImage = () => ({
  createFromPath: (_path: string) => ({
    toDataURL: () => '',
    toPNG: () => Buffer.alloc(0),
  }),
  createFromBuffer: (_buffer: Buffer) => ({
    toDataURL: () => '',
    toPNG: () => Buffer.alloc(0),
  }),
});
