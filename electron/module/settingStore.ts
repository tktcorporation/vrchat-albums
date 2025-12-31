import type { Rectangle } from 'electron';
import Store from 'electron-store';
import type * as neverthrow from 'neverthrow';
import { fromThrowable } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { z } from 'zod';
import { FolderDigestSchema } from '../lib/brandedTypes';

type TestPlaywrightStoreName = `test-playwright-settings-${string}`;
type StoreName = 'v0-settings' | 'test-settings' | TestPlaywrightStoreName;

const settingStoreKey = [
  'logFilesDir',
  'vrchatPhotoDir',
  'vrchatPhotoExtraDirList',
  'removeAdjacentDuplicateWorldEntriesFlag',
  'backgroundFileCreateFlag',
  'termsAccepted',
  'termsVersion',
  'migrationNoticeShown',
  'photoFolderScanStates',
] as const;
type SettingStoreKey = (typeof settingStoreKey)[number];

/**
 * フォルダスキャン状態（永続化用）
 * 各フォルダのダイジェストと最終スキャン日時を保持
 */
export const FolderScanStateSchema = z.object({
  /** ファイル一覧のダイジェスト（MD5ハッシュ値、FolderDigest型） */
  digest: FolderDigestSchema,
  /**
   * 最終スキャン完了日時（ISO 8601形式、UTC）
   * このフォルダの処理が完了した時点で更新される
   */
  lastScannedAt: z
    .string()
    .datetime({ message: 'Invalid ISO datetime format' }),
});

export type FolderScanState = z.infer<typeof FolderScanStateSchema>;

/** フォルダパス → スキャン状態のマップ */
export const PhotoFolderScanStatesSchema = z.record(
  z.string().min(1),
  FolderScanStateSchema,
);

export type PhotoFolderScanStates = z.infer<typeof PhotoFolderScanStatesSchema>;

/**
 * 設定ストアの操作エラー
 */
export type SettingStoreError = {
  type: 'STORAGE_ERROR';
  message: string;
  key: SettingStoreKey;
};

const getValue =
  (settingsStore: Store) =>
  (key: SettingStoreKey): unknown => {
    const value = settingsStore.get(key);
    return value;
  };

const setValue =
  (settingsStore: Store) => (key: SettingStoreKey, value: unknown) => {
    settingsStore.set(key, value);
  };

const getStr =
  (get: (key: SettingStoreKey) => unknown) =>
  (key: SettingStoreKey): string | null => {
    const value = get(key);
    return match(value)
      .when(
        (v): v is string => typeof v === 'string',
        (v) => v,
      )
      .otherwise(() => null);
  };

const getBool =
  (get: (key: SettingStoreKey) => unknown) =>
  (key: SettingStoreKey): boolean | null => {
    const value = get(key);
    return match(value)
      .when(
        (v): v is boolean => typeof v === 'boolean',
        (v) => v,
      )
      .otherwise(() => null);
  };

const getLogFilesDir =
  (getS: (key: SettingStoreKey) => string | null) => (): string | null => {
    return getS('logFilesDir');
  };
const setLogFilesDir =
  (set: (key: SettingStoreKey, value: unknown) => void) =>
  (dirPath: string) => {
    set('logFilesDir', dirPath);
  };

const getVRChatPhotoDir =
  (getS: (key: SettingStoreKey) => string | null) => (): string | null => {
    return getS('vrchatPhotoDir');
  };
const setVRChatPhotoDir =
  (set: (key: SettingStoreKey, value: unknown) => void) =>
  (dirPath: string) => {
    set('vrchatPhotoDir', dirPath);
  };

/**
 * 連続して同じワールドに入った場合に、2回目以降のワールド入場ログを削除するかどうか
 */
const getRemoveAdjacentDuplicateWorldEntriesFlag =
  (getB: (key: SettingStoreKey) => boolean | null) => (): boolean | null => {
    const value = getB('removeAdjacentDuplicateWorldEntriesFlag');
    return match(value)
      .when(
        (v): v is boolean => typeof v === 'boolean',
        (v) => v,
      )
      .otherwise(() => null);
  };
const setRemoveAdjacentDuplicateWorldEntriesFlag =
  (set: (key: SettingStoreKey, value: unknown) => void) => (flag: boolean) => {
    set('removeAdjacentDuplicateWorldEntriesFlag', flag);
  };

/**
 * バックグラウンドでファイル作成処理を行うかどうか
 */
const setBackgroundFileCreateFlag =
  (set: (key: SettingStoreKey, value: unknown) => void) => (flag: boolean) => {
    set('backgroundFileCreateFlag', flag);
  };

const getBackgroundFileCreateFlag =
  (getB: (key: SettingStoreKey) => boolean | null) => (): boolean | null => {
    const value = getB('backgroundFileCreateFlag');
    return match(value)
      .when(
        (v): v is boolean => typeof v === 'boolean',
        (v) => v,
      )
      .otherwise(() => null);
  };

/**
 * 規約同意状態
 */
const getTermsAccepted =
  (getB: (key: SettingStoreKey) => boolean | null) => (): boolean => {
    const value = getB('termsAccepted');
    return value ?? false;
  };

const setTermsAccepted =
  (set: (key: SettingStoreKey, value: unknown) => void) => (flag: boolean) => {
    set('termsAccepted', flag);
  };

const getTermsVersion =
  (getS: (key: SettingStoreKey) => string | null) => (): string => {
    const value = getS('termsVersion');
    return value ?? '';
  };

const setTermsVersion =
  (set: (key: SettingStoreKey, value: unknown) => void) =>
  (version: string) => {
    set('termsVersion', version);
  };

/**
 * 移行通知表示状態
 */
const getMigrationNoticeShown =
  (getB: (key: SettingStoreKey) => boolean | null) => (): boolean => {
    const value = getB('migrationNoticeShown');
    return value ?? false;
  };

const setMigrationNoticeShown =
  (set: (key: SettingStoreKey, value: unknown) => void) => (flag: boolean) => {
    set('migrationNoticeShown', flag);
  };

/**
 * Clear all settings
 */
const clearAllStoredSettings = (settingsStore: Store) => () => {
  settingsStore.clear();
};

/**
 * Clear stored setting by key
 */
const clearStoredSetting =
  (settingsStore: Store) =>
  (key: SettingStoreKey): neverthrow.Result<void, SettingStoreError> => {
    const safeDelete = fromThrowable(
      () => settingsStore.delete(key),
      (error): SettingStoreError => {
        return match(error)
          .with(P.instanceOf(Error), (e) => ({
            type: 'STORAGE_ERROR' as const,
            message: e.message,
            key,
          }))
          .otherwise((e) => {
            // 予期しないエラーはre-throw（Sentry通知）
            throw e;
          });
      },
    );
    return safeDelete();
  };

import path from 'node:path';
import { logger } from './../lib/logger';
import {
  type VRChatPhotoDirPath,
  VRChatPhotoDirPathSchema,
} from './vrchatPhoto/valueObjects';

let settingStore: ReturnType<typeof setSettingStore> | null = null;
const setSettingStore = (name: StoreName) => {
  const store = new Store({ name });
  const { get, set } = {
    get: getValue(store),
    set: setValue(store),
  };
  const { getStr: getS, getBool: getB } = {
    getStr: getStr(get),
    getBool: getBool(get),
  };
  const getVRChatPhotoExtraDirList = () => (): VRChatPhotoDirPath[] => {
    const value = get('vrchatPhotoExtraDirList');
    return match(value)
      .when(
        (v): v is unknown[] => Array.isArray(v),
        (v) => {
          const parsedValue = v.filter(
            (item): item is string => typeof item === 'string',
          );
          return parsedValue.map((item) =>
            VRChatPhotoDirPathSchema.parse(item),
          );
        },
      )
      .otherwise(() => []);
  };

  const setVRChatPhotoExtraDirList =
    (set: (key: SettingStoreKey, value: unknown) => void) =>
    (dirPaths: string[]) => {
      set('vrchatPhotoExtraDirList', dirPaths);
    };

  const _settingStore = {
    __store: store,
    getLogFilesDir: getLogFilesDir(getS),
    setLogFilesDir: setLogFilesDir(set),
    getVRChatPhotoDir: getVRChatPhotoDir(getS),
    setVRChatPhotoDir: setVRChatPhotoDir(set),
    getVRChatPhotoExtraDirList: getVRChatPhotoExtraDirList(),
    setVRChatPhotoExtraDirList: setVRChatPhotoExtraDirList(set),
    getRemoveAdjacentDuplicateWorldEntriesFlag:
      getRemoveAdjacentDuplicateWorldEntriesFlag(getB),
    setRemoveAdjacentDuplicateWorldEntriesFlag:
      setRemoveAdjacentDuplicateWorldEntriesFlag(set),
    getBackgroundFileCreateFlag: getBackgroundFileCreateFlag(getB),
    setBackgroundFileCreateFlag: setBackgroundFileCreateFlag(set),
    clearAllStoredSettings: clearAllStoredSettings(store),
    clearStoredSetting: clearStoredSetting(store),
    setWindowBounds: (bounds: Rectangle) => {
      store.set('windowBounds', bounds);
    },
    getWindowBounds: (): Rectangle | undefined => {
      const bounds = store.get('windowBounds');
      return match(bounds)
        .when(
          (b): b is Rectangle =>
            b !== null &&
            typeof b === 'object' &&
            'x' in b &&
            'y' in b &&
            'width' in b &&
            'height' in b,
          (b) => b,
        )
        .otherwise(() => undefined);
    },
    getTermsAccepted: getTermsAccepted(getB),
    setTermsAccepted: setTermsAccepted(set),
    getTermsVersion: getTermsVersion(getS),
    setTermsVersion: setTermsVersion(set),
    getMigrationNoticeShown: getMigrationNoticeShown(getB),
    setMigrationNoticeShown: setMigrationNoticeShown(set),
    getPhotoFolderScanStates: (): PhotoFolderScanStates => {
      const value = get('photoFolderScanStates');
      const result = PhotoFolderScanStatesSchema.safeParse(value);
      return match(result)
        .with({ success: true }, (r) => r.data)
        .with({ success: false }, (r) => {
          // バリデーションエラー時はログ出力して空オブジェクトを返す
          // データ破損は予期しないエラーのため logger.error を使用（Sentry送信対象）
          if (value !== null && value !== undefined) {
            logger.error({
              message:
                'Invalid photoFolderScanStates data, resetting to empty. This may indicate a bug or data corruption.',
              stack: new Error(r.error.message),
              details: {
                valueType: typeof value,
                isArray: Array.isArray(value),
              },
            });
            // 破損データをクリアして次回から正常に動作させる
            set('photoFolderScanStates', {});
          }
          return {};
        })
        .exhaustive();
    },
    setPhotoFolderScanStates: (states: PhotoFolderScanStates) => {
      set('photoFolderScanStates', states);
    },
    clearPhotoFolderScanStates: () => {
      set('photoFolderScanStates', {});
    },
  };
  settingStore = _settingStore;
  return _settingStore;
};

const initSettingStore = (name?: StoreName) => {
  const storeName: StoreName =
    name ??
    (process.env.PLAYWRIGHT_TEST === 'true' && process.env.PLAYWRIGHT_STORE_HASH
      ? `test-playwright-settings-${process.env.PLAYWRIGHT_STORE_HASH}`
      : 'v0-settings');

  if (settingStore !== null) {
    const existsPath = settingStore.__store.path;
    const existsName = path.basename(existsPath, '.json');
    logger.info(
      `SettingStore already initialized. existsName: ${existsName}, newName: ${storeName}。file: ${existsPath}`,
    );
    if (existsName === storeName) {
      return getSettingStore();
    }
    throw new Error('SettingStore already initialized');
  }
  setSettingStore(storeName);
  return getSettingStore();
};
const initSettingStoreForTest = (
  settingStoreSpy: ReturnType<typeof getSettingStore>,
) => {
  settingStore = settingStoreSpy;
};
const getSettingStore = () => {
  if (settingStore === null) {
    throw new Error('SettingStore not initialized');
  }
  return settingStore;
};

export interface SettingStore {
  __store: Store<Record<string, unknown>>;
  getLogFilesDir: () => string | null;
  setLogFilesDir: (dirPath: string) => void;
  getVRChatPhotoDir: () => string | null;
  setVRChatPhotoDir: (dirPath: string) => void;
  getVRChatPhotoExtraDirList: () => VRChatPhotoDirPath[];
  setVRChatPhotoExtraDirList: (dirPaths: string[]) => void;
  getRemoveAdjacentDuplicateWorldEntriesFlag: () => boolean | null;
  setRemoveAdjacentDuplicateWorldEntriesFlag: (flag: boolean) => void;
  getBackgroundFileCreateFlag: () => boolean | null;
  setBackgroundFileCreateFlag: (flag: boolean) => void;
  clearAllStoredSettings: () => void;
  clearStoredSetting: (
    key: SettingStoreKey,
  ) => neverthrow.Result<void, SettingStoreError>;
  getWindowBounds: () => Rectangle | undefined;
  setWindowBounds: (bounds: Rectangle) => void;
  getTermsAccepted: () => boolean;
  setTermsAccepted: (accepted: boolean) => void;
  getTermsVersion: () => string;
  setTermsVersion: (version: string) => void;
  getMigrationNoticeShown: () => boolean;
  setMigrationNoticeShown: (shown: boolean) => void;
  getPhotoFolderScanStates: () => PhotoFolderScanStates;
  setPhotoFolderScanStates: (states: PhotoFolderScanStates) => void;
  clearPhotoFolderScanStates: () => void;
}

export { getSettingStore, initSettingStore, initSettingStoreForTest };
