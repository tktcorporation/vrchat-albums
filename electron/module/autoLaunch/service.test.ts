import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLoginItemSettings, setLoginItemSettings } from './service';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

describe('autoLaunch service', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOME = '/tmp/test-home';
    process.env.XDG_CONFIG_HOME = '/tmp/test-config';
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  const setPlatform = (platform: string) => {
    Object.defineProperty(process, 'platform', { value: platform });
  };

  describe('macOS (LaunchAgent plist)', () => {
    const plistPath =
      '/tmp/test-home/Library/LaunchAgents/com.tktcorporation.vrchat-albums.plist';

    beforeEach(() => {
      setPlatform('darwin');
    });

    afterEach(() => {
      // plist ファイルのクリーンアップ
      // effect-lint-allow-try-catch: テストのクリーンアップ
      try {
        fs.unlinkSync(plistPath);
      } catch {
        // ファイルが存在しない場合は無視
      }
      // effect-lint-allow-try-catch: テストのクリーンアップ
      try {
        fs.rmdirSync(path.dirname(plistPath));
      } catch {
        // ディレクトリが存在しないか空でない場合は無視
      }
    });

    it('setLoginItemSettings(true) で plist ファイルが作成される', () => {
      setLoginItemSettings({ openAtLogin: true });

      expect(fs.existsSync(plistPath)).toBe(true);
      const content = fs.readFileSync(plistPath, 'utf8');
      expect(content).toContain('com.tktcorporation.vrchat-albums');
      expect(content).toContain('<true/>'); // RunAtLoad
      expect(content).toContain('--hidden');
    });

    it('setLoginItemSettings(false) で plist ファイルが削除される', () => {
      // まず作成
      setLoginItemSettings({ openAtLogin: true });
      expect(fs.existsSync(plistPath)).toBe(true);

      // 削除
      setLoginItemSettings({ openAtLogin: false });
      expect(fs.existsSync(plistPath)).toBe(false);
    });

    it('getLoginItemSettings で plist の存在を確認できる', () => {
      expect(getLoginItemSettings().openAtLogin).toBe(false);

      setLoginItemSettings({ openAtLogin: true });
      expect(getLoginItemSettings().openAtLogin).toBe(true);

      setLoginItemSettings({ openAtLogin: false });
      expect(getLoginItemSettings().openAtLogin).toBe(false);
    });
  });

  describe('Linux (.desktop file)', () => {
    const desktopPath =
      '/tmp/test-config/autostart/com.tktcorporation.vrchat-albums.desktop';

    beforeEach(() => {
      setPlatform('linux');
    });

    afterEach(() => {
      // effect-lint-allow-try-catch: テストのクリーンアップ
      try {
        fs.unlinkSync(desktopPath);
      } catch {
        // ファイルが存在しない場合は無視
      }
      // effect-lint-allow-try-catch: テストのクリーンアップ
      try {
        fs.rmdirSync(path.dirname(desktopPath));
      } catch {
        // ディレクトリが存在しないか空でない場合は無視
      }
    });

    it('setLoginItemSettings(true) で .desktop ファイルが作成される', () => {
      setLoginItemSettings({ openAtLogin: true });

      expect(fs.existsSync(desktopPath)).toBe(true);
      const content = fs.readFileSync(desktopPath, 'utf8');
      expect(content).toContain('Type=Application');
      expect(content).toContain('Name=VRChatAlbums');
      expect(content).toContain('X-GNOME-Autostart-enabled=true');
      expect(content).toContain('--hidden');
    });

    it('setLoginItemSettings(false) で .desktop ファイルが削除される', () => {
      setLoginItemSettings({ openAtLogin: true });
      expect(fs.existsSync(desktopPath)).toBe(true);

      setLoginItemSettings({ openAtLogin: false });
      expect(fs.existsSync(desktopPath)).toBe(false);
    });

    it('getLoginItemSettings で .desktop ファイルの存在を確認できる', () => {
      expect(getLoginItemSettings().openAtLogin).toBe(false);

      setLoginItemSettings({ openAtLogin: true });
      expect(getLoginItemSettings().openAtLogin).toBe(true);
    });
  });

  describe('Windows (Registry)', () => {
    beforeEach(() => {
      setPlatform('win32');
    });

    it('setLoginItemSettings(true) で REG ADD が呼ばれる', () => {
      setLoginItemSettings({ openAtLogin: true });

      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        'REG',
        expect.arrayContaining([
          'ADD',
          expect.any(String),
          '/v',
          'VRChatAlbums',
          '/f',
        ]),
      );
    });

    it('setLoginItemSettings(false) で REG DELETE が呼ばれる', () => {
      setLoginItemSettings({ openAtLogin: false });

      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        'REG',
        expect.arrayContaining([
          'DELETE',
          expect.any(String),
          '/v',
          'VRChatAlbums',
          '/f',
        ]),
      );
    });

    it('getLoginItemSettings は REG QUERY の成否で判定する', () => {
      // REG QUERY 成功 → openAtLogin: true
      vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from(''));
      expect(getLoginItemSettings().openAtLogin).toBe(true);

      // REG QUERY 失敗 → openAtLogin: false
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error('not found');
      });
      expect(getLoginItemSettings().openAtLogin).toBe(false);
    });
  });

  describe('未対応プラットフォーム', () => {
    it('freebsd 等では false を返し、エラーにならない', () => {
      setPlatform('freebsd');

      expect(getLoginItemSettings().openAtLogin).toBe(false);
      expect(() => setLoginItemSettings({ openAtLogin: true })).not.toThrow();
    });
  });
});
