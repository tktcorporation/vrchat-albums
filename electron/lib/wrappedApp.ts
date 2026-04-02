/**
 * アプリケーションパス取得ユーティリティ。
 *
 * 背景: Electron の app.getPath('userData') の代替。
 * Electrobun の Utils.paths.userData にマッピング。
 * テスト環境ではフォールバックパスを返す。
 *
 * 呼び出し元: electron/lib/sequelize.ts, electron/index.ts
 */
import * as compat from './electrobunCompat';

/**
 * ユーザーデータディレクトリのパスを取得する。
 * ex. ~/.config/com.tktcorporation.vrchat-albums/ (Linux)
 * ex. ~/Library/Application Support/com.tktcorporation.vrchat-albums/ (macOS)
 * ex. %APPDATA%/com.tktcorporation.vrchat-albums/ (Windows)
 */
export const getAppUserDataPath = (): string => {
  try {
    return compat.getAppUserDataPath();
  } catch {
    // テストまたは非 Electrobun 環境
    return '/tmp/test-user-data';
  }
};
