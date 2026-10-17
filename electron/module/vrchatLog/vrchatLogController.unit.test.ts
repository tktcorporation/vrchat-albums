import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// テスト用のユーザーデータディレクトリを設定
const testUserDataDir = path.join(
  os.tmpdir(),
  `vrchat-albums-test-${uuidv7()}`,
);

// モック設定を最初に定義
vi.mock('../../lib/wrappedApp', () => ({
  getAppUserDataPath: vi.fn(() => testUserDataDir),
}));

vi.mock('./exportService/exportService', () => {
  const { Effect } = require('effect');
  return {
    exportLogStoreFromDB: vi.fn(({ outputBasePath }) =>
      Effect.succeed({
        totalLogLines: 0,
        exportedFiles: [
          `${outputBasePath}/vrchat-albums-export_2023-12-01_14-30-45/2023-11/logStore-2023-11.txt`,
        ],
        exportStartTime: new Date(),
        exportEndTime: new Date(),
      }),
    ),
    // vi.mock はモジュールを完全に差し替えるため、controller 側の
    // import { getExportErrorMessage } を解決させるためにも export 必須。
    // 未指定だと undefined となり、エラー経路で TypeError を投げる。
    getExportErrorMessage: vi.fn(String),
  };
});

vi.mock('../logSync/service', () => {
  const { Effect } = require('effect');
  return {
    LOG_SYNC_MODE: {
      FULL: 'FULL',
      INCREMENTAL: 'INCREMENTAL',
    },
    // syncLogs returns Effect, not Promise
    syncLogs: vi.fn(() =>
      Effect.succeed({
        createdWorldJoinLogModelList: [],
        createdPlayerJoinLogModelList: [],
        createdPlayerLeaveLogModelList: [],
        createdVRChatPhotoPathModelList: [],
      }),
    ),
  };
});

vi.mock('../fileHandlers/logStorageManager', () => {
  const { Effect } = require('effect');
  return {
    // appendLoglinesToFile returns Effect<void, never>
    appendLoglinesToFile: vi.fn(() => Effect.void),
    getLogStoreDir: vi.fn(() => '/tmp/test-logStore'),
    initLogStoreDir: vi.fn(),
  };
});

// データベースのモック
vi.mock('../../lib/sequelize', () => ({
  __initTestRDBClient: vi.fn(),
  __forceSyncRDBClient: vi.fn(),
  __cleanupTestRDBClient: vi.fn(),
}));

// 規約の同意を要する手続きを呼ぶため、実ストアの読み書きはそのままに、同意状態だけをテストから切り替える。
// version が null なら現在の版に同意済みと報告する
const termsConsent = vi.hoisted(() => ({
  accepted: true,
  version: null as string | null,
}));
vi.mock('../settingStore', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingStoreModule>();
  const { TERMS_VERSION } =
    await import('../../../src/v2/constants/terms/version');
  return {
    ...actual,
    getSettingStore: () => ({
      ...actual.getSettingStore(),
      getTermsAccepted: () => termsConsent.accepted,
      getTermsVersion: () => termsConsent.version ?? TERMS_VERSION,
    }),
  };
});

import { eventEmitter } from '../../trpc';
// モック後にインポート
import type * as SettingStoreModule from '../settingStore';
import { initSettingStore } from '../settingStore';
import { rollbackService } from './backupService/rollbackService';
import { importService } from './importService/importService';
import { vrchatLogRouter } from './vrchatLogController';

describe('vrchatLogController unit tests - Import and Rollback', () => {
  let router: ReturnType<typeof vrchatLogRouter>;
  let caller: ReturnType<ReturnType<typeof vrchatLogRouter>['createCaller']>;
  let logStoreDir: string;
  let backupsDir: string;
  let testExportDir: string;

  beforeEach(async () => {
    termsConsent.accepted = true;
    termsConsent.version = null;

    // 設定ストアとルーター初期化
    initSettingStore();
    router = vrchatLogRouter();
    caller = router.createCaller({ eventEmitter });

    // テスト用ディレクトリ作成
    logStoreDir = path.join(testUserDataDir, 'logStore');
    backupsDir = path.join(testUserDataDir, 'backups');
    testExportDir = path.join(os.tmpdir(), `test-export-${uuidv7()}`);

    await fs.mkdir(logStoreDir, { recursive: true });
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.mkdir(testExportDir, { recursive: true });

    // イベントエミッターのリスナーをクリア
    eventEmitter.removeAllListeners();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // テスト用ディレクトリをクリーンアップ
    await fs.rm(testUserDataDir, { recursive: true, force: true });
    await fs.rm(testExportDir, { recursive: true, force: true });
  });

  const createTestLogStoreFile = async (yearMonth: string, content: string) => {
    const monthDir = path.join(testExportDir, yearMonth);
    await fs.mkdir(monthDir, { recursive: true });
    const filePath = path.join(monthDir, `logStore-${yearMonth}.txt`);
    await fs.writeFile(filePath, content);
    return filePath;
  };

  describe('Import フロー', () => {
    it('logStoreファイルをインポートできる', async () => {
      // テスト用のファイルを作成
      const testLogContent = [
        '2023-11-02 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Import Test World',
        '2023-11-02 15:31:00 Log        -  [Behaviour] OnPlayerJoined ImportTestPlayer',
      ].join('\n');
      const testFilePath = await createTestLogStoreFile(
        '2023-11',
        testLogContent,
      );

      // インポート実行
      const importResult = await caller.importLogStoreFiles({
        filePaths: [testFilePath],
      });

      expect(importResult).toBeDefined();
      expect(importResult.success).toBe(true);
      expect(importResult.importedData.totalLines).toBe(2);
      expect(importResult.backup).toBeDefined();
    });

    it('無効なファイルのインポートはエラーになる', async () => {
      await expect(
        caller.importLogStoreFiles({ filePaths: ['/non/existent/file.txt'] }),
      ).rejects.toThrow(
        'インポート対象のlogStoreファイルが見つかりませんでした',
      );
    });
  });

  describe('バックアップ履歴', () => {
    it('バックアップ履歴を取得できる', async () => {
      // バックアップ履歴の取得
      const historyResult = await caller.getImportBackupHistory();

      // 初期状態では空であることを確認
      expect(historyResult).toEqual([]);
    });
  });

  describe('ロールバック', () => {
    it('存在しないバックアップへのロールバックはエラーになる', async () => {
      await expect(
        caller.rollbackToBackup({ backupId: 'non-existent-backup-id' }),
      ).rejects.toThrow('バックアップが見つかりません');
    });
  });

  describe('利用規約への同意', () => {
    it('利用規約に未同意ならインポートせずに拒む', async () => {
      termsConsent.accepted = false;
      const importSpy = vi.spyOn(importService, 'importLogStoreFiles');

      await expect(
        caller.importLogStoreFiles({ filePaths: ['/any/logStore.txt'] }),
      ).rejects.toThrow('利用規約に同意してから操作してください');
      expect(importSpy).not.toHaveBeenCalled();
    });

    it('古い版の規約にしか同意していなければインポートせずに拒む', async () => {
      termsConsent.version = '0.0';
      const importSpy = vi.spyOn(importService, 'importLogStoreFiles');

      await expect(
        caller.importLogStoreFiles({ filePaths: ['/any/logStore.txt'] }),
      ).rejects.toThrow('利用規約に同意してから操作してください');
      expect(importSpy).not.toHaveBeenCalled();
    });

    it('利用規約に未同意ならロールバックせずに拒む', async () => {
      termsConsent.accepted = false;
      const rollbackSpy = vi.spyOn(rollbackService, 'rollbackToBackup');

      await expect(
        caller.rollbackToBackup({ backupId: 'any-backup-id' }),
      ).rejects.toThrow('利用規約に同意してから操作してください');
      expect(rollbackSpy).not.toHaveBeenCalled();
    });

    it('古い版の規約にしか同意していなければロールバックせずに拒む', async () => {
      termsConsent.version = '0.0';
      const rollbackSpy = vi.spyOn(rollbackService, 'rollbackToBackup');

      await expect(
        caller.rollbackToBackup({ backupId: 'any-backup-id' }),
      ).rejects.toThrow('利用規約に同意してから操作してください');
      expect(rollbackSpy).not.toHaveBeenCalled();
    });
  });
});
