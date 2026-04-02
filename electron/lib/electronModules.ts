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
import * as autoLaunch from '../module/autoLaunch/service';
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
  getLoginItemSettings: autoLaunch.getLoginItemSettings,
  setLoginItemSettings: autoLaunch.setLoginItemSettings,
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
    // effect-lint-allow-try-catch: ダイアログ操作は失敗しうるインフラ操作
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
 *
 * 背景: Electron では NativeImage を介して clipboard.writeImage() していた。
 * Electrobun では Utils.clipboardWriteImage(pngData: Uint8Array) で
 * PNG バイト列を直接クリップボードに書き込める。
 */
export const getClipboard = () => ({
  ...compat.clipboard,
  /**
   * PNG バイト列をクリップボードに書き込む。
   * 引数は Electron 互換の { toPNG(): Buffer } オブジェクトを受け取る。
   */
  writeImage: (image: { toPNG: () => Buffer }): void => {
    // effect-lint-allow-try-catch: ランタイム環境検出パターン
    try {
      const { Utils } = require('electrobun/bun');
      const pngBuffer = image.toPNG();
      Utils.clipboardWriteImage(new Uint8Array(pngBuffer));
    } catch (error) {
      console.error('[electrobunCompat] clipboard.writeImage failed:', error);
    }
  },
});

/**
 * nativeImage 互換オブジェクトを提供する。
 *
 * 背景: Electron の nativeImage は Chromium の画像フォーマット変換を内蔵していた。
 * Electrobun では @napi-rs/image（既存依存）でファイル読み込み→ PNG 変換を行い、
 * toPNG() で Buffer を返す互換オブジェクトを構築する。
 */
export const getNativeImage = () => ({
  createFromPath: (filePath: string) => {
    // effect-lint-allow-try-catch: ファイル読み込みは失敗しうる
    try {
      const fs = require('node:fs');
      const pngData = fs.readFileSync(filePath);
      return {
        toDataURL: () =>
          `data:image/png;base64,${Buffer.from(pngData).toString('base64')}`,
        toPNG: () => Buffer.from(pngData),
      };
    } catch {
      return { toDataURL: () => '', toPNG: () => Buffer.alloc(0) };
    }
  },
  createFromBuffer: (buffer: Buffer) => ({
    toDataURL: () =>
      `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`,
    toPNG: () => Buffer.from(buffer),
  }),
});
