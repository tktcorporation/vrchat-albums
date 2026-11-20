import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import Store from 'electron-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerHost } from '../lib/host';
import { createTestHost } from '../lib/host/testHost';
import {
  readSettingsSnapshot,
  settingStoreFilePath,
} from '../lib/settingsFile';
import {
  getSettingStore,
  initSettingStore,
  resolveElectronStoreClass,
} from './settingStore';

/**
 * 利用者の手元に既にある設定ファイルを、今の electron-store で同じ値として読めるかを確かめる。
 *
 * 設定ファイルは electron-store（conf）が書いた JSON で、アプリの更新後もそのまま読み続ける。
 * 保存先（userData 直下の `<name>.json`）・キー・値の形のどれかが読めなくなると、利用者の設定が
 * 初期値に戻る。下の内容は、conf が書く形（タブで字下げした JSON）で全キーを埋めたもの。
 */
const EXISTING_SETTINGS = {
  logFilesDir: 'C:\\Users\\user.name\\AppData\\LocalLow\\VRChat\\VRChat',
  vrchatPhotoDir: 'C:\\Users\\user.name\\Pictures\\VRChat',
  vrchatPhotoExtraDirList: ['D:\\VRChat Photos', 'E:\\old.photos'],
  removeAdjacentDuplicateWorldEntriesFlag: true,
  backgroundFileCreateFlag: true,
  termsAccepted: true,
  termsVersion: '1.2.0',
  migrationNoticeShown: true,
  photoFolderScanStates: {
    'C:\\Users\\user.name\\Pictures\\VRChat\\2026-01': {
      digest: '0123456789abcdef0123456789abcdef',
      lastScannedAt: '2026-01-31T12:34:56.000Z',
    },
  },
  worldJoinImageGenerationEnabled: false,
  autoStartEnabled: true,
  windowBounds: { x: 10, y: 20, width: 1280, height: 800 },
  __internal__: { migrations: { version: '0.31.6' } },
};

describe('設定ファイルの互換性（既存の設定を読む）', () => {
  let userDataDir: string;
  let filePath: string;

  beforeAll(() => {
    userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'vrchat-albums-settings-compat-'),
    );
    filePath = settingStoreFilePath(userDataDir, 'v0-settings');
    fs.writeFileSync(
      filePath,
      JSON.stringify(EXISTING_SETTINGS, undefined, '\t'),
    );
    registerHost(createTestHost({ paths: { userData: userDataDir } }));
    initSettingStore('v0-settings');
  });

  afterAll(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    registerHost(createTestHost());
  });

  it('userData 直下の既存ファイルを開く', () => {
    expect(getSettingStore().__store.path).toBe(filePath);
  });

  it('既存の全キーを同じ値で読む', () => {
    const store = getSettingStore();
    expect(store.getLogFilesDir()).toBe(EXISTING_SETTINGS.logFilesDir);
    expect(store.getVRChatPhotoDir()).toBe(EXISTING_SETTINGS.vrchatPhotoDir);
    expect(store.getVRChatPhotoExtraDirList().map((dir) => dir.value)).toEqual(
      EXISTING_SETTINGS.vrchatPhotoExtraDirList,
    );
    expect(store.getRemoveAdjacentDuplicateWorldEntriesFlag()).toBe(true);
    expect(store.getBackgroundFileCreateFlag()).toBe(true);
    expect(store.getTermsAccepted()).toBe(true);
    expect(store.getTermsVersion()).toBe('1.2.0');
    expect(store.getMigrationNoticeShown()).toBe(true);
    expect(store.getPhotoFolderScanStates()).toEqual(
      EXISTING_SETTINGS.photoFolderScanStates,
    );
    expect(store.getWorldJoinImageGenerationEnabled()).toBe(false);
    expect(store.getAutoStartEnabled()).toBe(true);
    expect(store.getWindowBounds()).toEqual(EXISTING_SETTINGS.windowBounds);
  });

  it('1 つのキーを書いても、ほかのキーを同じファイルに残し、main の読み出しでも読める', () => {
    getSettingStore().setTermsVersion('1.3.0');

    const written: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(written).toMatchObject({
      ...EXISTING_SETTINGS,
      termsVersion: '1.3.0',
    });
    expect(readSettingsSnapshot(filePath)).toEqual({
      termsAccepted: true,
      termsVersion: '1.3.0',
      backgroundFileCreateFlag: true,
      windowBounds: EXISTING_SETTINGS.windowBounds,
    });
  });
});

describe('resolveElectronStoreClass', () => {
  it('ESM のまま読んだクラスをそのまま返す', () => {
    expect(resolveElectronStoreClass(Store)).toBe(Store);
  });

  it('CJS の出力が require() で受け取る名前空間から default のクラスを取り出す', () => {
    const namespace = { __esModule: true, default: Store };
    expect(resolveElectronStoreClass(namespace)).toBe(Store);
  });

  it('クラスを含まない値は読み込みの失敗として投げる', () => {
    expect(() => resolveElectronStoreClass({})).toThrow(TypeError);
  });
});
