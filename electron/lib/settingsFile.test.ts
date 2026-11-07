import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readSettingsSnapshot,
  resolveSettingStoreName,
  settingStoreFilePath,
} from './settingsFile';

describe('resolveSettingStoreName', () => {
  it('通常は v0-settings を使う', () => {
    expect(resolveSettingStoreName({})).toBe('v0-settings');
    expect(resolveSettingStoreName({ PLAYWRIGHT_STORE_HASH: 'x' })).toBe(
      'v0-settings',
    );
  });

  it('Playwright のテストでは実行ごとのファイルを使う', () => {
    expect(
      resolveSettingStoreName({
        PLAYWRIGHT_TEST: 'true',
        PLAYWRIGHT_STORE_HASH: 'abc',
      }),
    ).toBe('test-playwright-settings-abc');
  });
});

describe('readSettingsSnapshot', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-file-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (content: string) => {
    const file = settingStoreFilePath(dir, 'v0-settings');
    fs.writeFileSync(file, content);
    return file;
  };

  const DEFAULTS = {
    termsAccepted: false,
    termsVersion: '',
    backgroundFileCreateFlag: false,
    windowBounds: undefined,
  };

  it('ファイルが無ければ既定値を返す', () => {
    expect(
      readSettingsSnapshot(settingStoreFilePath(dir, 'v0-settings')),
    ).toEqual(DEFAULTS);
  });

  it('JSON として読めなければ既定値を返す', () => {
    expect(readSettingsSnapshot(write('{not json'))).toEqual(DEFAULTS);
  });

  it('JSON の値がオブジェクトでなければ既定値を返す', () => {
    expect(readSettingsSnapshot(write('[1, 2]'))).toEqual(DEFAULTS);
  });

  it('main が使う項目を読み、型の違う項目は未設定として扱う', () => {
    const file = write(
      JSON.stringify({
        termsAccepted: true,
        termsVersion: '1.0.0',
        backgroundFileCreateFlag: 'yes',
        windowBounds: { x: 1, y: 2, width: 800, height: 600 },
        logFilesDir: '/ignored',
      }),
    );

    expect(readSettingsSnapshot(file)).toEqual({
      termsAccepted: true,
      termsVersion: '1.0.0',
      backgroundFileCreateFlag: false,
      windowBounds: { x: 1, y: 2, width: 800, height: 600 },
    });
  });

  it('読むたびにファイルを開き直し、書き換えを反映する', () => {
    const file = write(JSON.stringify({ termsAccepted: false }));
    expect(readSettingsSnapshot(file).termsAccepted).toBe(false);

    fs.writeFileSync(file, JSON.stringify({ termsAccepted: true }));
    expect(readSettingsSnapshot(file).termsAccepted).toBe(true);
  });
});
