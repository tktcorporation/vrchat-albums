/**
 * クロスプラットフォームのログイン時自動起動サービス。
 *
 * 背景: Electron の app.setLoginItemSettings() / getLoginItemSettings() に相当する機能を
 * Electrobun 環境で OS ネイティブの手段を使って再実装する。
 *
 * 各 OS の仕組み:
 *   - macOS: ~/Library/LaunchAgents/ に plist ファイルを配置
 *   - Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run レジストリキー
 *   - Linux: ~/.config/autostart/ に .desktop ファイルを配置
 *
 * 呼び出し元: electron/lib/electronModules.ts の getApp().setLoginItemSettings()
 * 対になる関数: getLoginItemSettings() (設定の取得)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { match } from 'ts-pattern';

import { logger } from '../../lib/logger';

/** アプリケーション識別子。plist ファイル名やレジストリキー名に使用 */
const APP_ID = 'com.tktcorporation.vrchat-albums';
const APP_NAME = 'VRChatAlbums';

/**
 * アプリの実行ファイルパスを取得する。
 *
 * 背景: パッケージ済みアプリでは process.execPath がランチャーバイナリを指す。
 * macOS では .app バンドルのパスに変換する必要がある（LaunchAgent はバンドルパスで起動）。
 */
const getAppExecutablePath = (): string => {
  const execPath = process.execPath;

  // macOS: /path/to/App.app/Contents/MacOS/launcher → /path/to/App.app を返す
  // LaunchAgent の ProgramArguments には open -a /path/to/App.app を使う
  if (process.platform === 'darwin') {
    const appBundleMatch = execPath.match(/^(.+\.app)\//);
    if (appBundleMatch?.[1]) {
      return appBundleMatch[1];
    }
  }

  return execPath;
};

// ─────────────────────────────────────────────
// macOS: LaunchAgent plist
// ─────────────────────────────────────────────

const getLaunchAgentPath = (): string => {
  const home = process.env.HOME ?? '';
  return path.join(home, 'Library', 'LaunchAgents', `${APP_ID}.plist`);
};

/**
 * macOS 用の LaunchAgent plist XML を生成する。
 *
 * RunAtLoad=true でログイン時に自動起動。
 * open -a を使うことで、.app バンドルとして正しく起動される。
 */
const buildPlistXml = (appPath: string): string => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${APP_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>open</string>
    <string>-a</string>
    <string>${appPath}</string>
    <string>--args</string>
    <string>--hidden</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;
};

const setAutoLaunchMacOS = (enabled: boolean): void => {
  const plistPath = getLaunchAgentPath();

  if (enabled) {
    const appPath = getAppExecutablePath();
    const plistContent = buildPlistXml(appPath);
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plistContent, 'utf8');
    logger.info(`LaunchAgent created: ${plistPath}`);
  } else {
    if (fs.existsSync(plistPath)) {
      fs.unlinkSync(plistPath);
      logger.info(`LaunchAgent removed: ${plistPath}`);
    }
  }
};

const getAutoLaunchMacOS = (): boolean => {
  return fs.existsSync(getLaunchAgentPath());
};

// ─────────────────────────────────────────────
// Windows: Registry (REG.exe via execFileSync)
// ─────────────────────────────────────────────

const REGISTRY_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;

const setAutoLaunchWindows = (enabled: boolean): void => {
  // effect-lint-allow-try-catch: OS コマンド実行のエラーハンドリング
  try {
    if (enabled) {
      const appPath = getAppExecutablePath();
      execFileSync('REG', [
        'ADD',
        REGISTRY_KEY,
        '/v',
        APP_NAME,
        '/d',
        appPath,
        '/f',
      ]);
      logger.info(`Registry key added: ${REGISTRY_KEY}\\${APP_NAME}`);
    } else {
      execFileSync('REG', ['DELETE', REGISTRY_KEY, '/v', APP_NAME, '/f']);
      logger.info(`Registry key removed: ${REGISTRY_KEY}\\${APP_NAME}`);
    }
  } catch (error) {
    logger.error({
      message: `Failed to ${enabled ? 'set' : 'remove'} Windows auto-launch registry key`,
      stack: error instanceof Error ? error : undefined,
    });
  }
};

const getAutoLaunchWindows = (): boolean => {
  // effect-lint-allow-try-catch: OS コマンド実行のエラーハンドリング
  try {
    execFileSync('REG', ['QUERY', REGISTRY_KEY, '/v', APP_NAME], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────
// Linux: .desktop file in autostart
// ─────────────────────────────────────────────

const getDesktopFilePath = (): string => {
  const configDir =
    process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? '', '.config');
  return path.join(configDir, 'autostart', `${APP_ID}.desktop`);
};

const buildDesktopEntry = (appPath: string): string => {
  return `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Exec=${appPath} --hidden
X-GNOME-Autostart-enabled=true
Hidden=false
NoDisplay=false
`;
};

const setAutoLaunchLinux = (enabled: boolean): void => {
  const desktopPath = getDesktopFilePath();

  if (enabled) {
    const appPath = getAppExecutablePath();
    const content = buildDesktopEntry(appPath);
    fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
    fs.writeFileSync(desktopPath, content, 'utf8');
    logger.info(`Desktop entry created: ${desktopPath}`);
  } else {
    if (fs.existsSync(desktopPath)) {
      fs.unlinkSync(desktopPath);
      logger.info(`Desktop entry removed: ${desktopPath}`);
    }
  }
};

const getAutoLaunchLinux = (): boolean => {
  return fs.existsSync(getDesktopFilePath());
};

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export interface LoginItemSettings {
  openAtLogin: boolean;
}

/**
 * ログイン時自動起動の設定を取得する。
 * Electron の app.getLoginItemSettings() に相当。
 */
export const getLoginItemSettings = (): LoginItemSettings => {
  const openAtLogin = match(process.platform)
    .with('darwin', () => getAutoLaunchMacOS())
    .with('win32', () => getAutoLaunchWindows())
    .with('linux', () => getAutoLaunchLinux())
    .otherwise(() => {
      logger.warn(`Unsupported platform for auto-launch: ${process.platform}`);
      return false;
    });

  return { openAtLogin };
};

/**
 * ログイン時自動起動の設定を変更する。
 * Electron の app.setLoginItemSettings() に相当。
 */
export const setLoginItemSettings = (settings: {
  openAtLogin: boolean;
  openAsHidden?: boolean;
}): void => {
  match(process.platform)
    .with('darwin', () => setAutoLaunchMacOS(settings.openAtLogin))
    .with('win32', () => setAutoLaunchWindows(settings.openAtLogin))
    .with('linux', () => setAutoLaunchLinux(settings.openAtLogin))
    .otherwise(() => {
      logger.warn(`Unsupported platform for auto-launch: ${process.platform}`);
    });
};
