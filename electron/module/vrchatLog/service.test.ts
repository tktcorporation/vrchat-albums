import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import neverthrow from 'neverthrow';
import { beforeEach, describe, expect, it, test, vi } from 'vitest';
import { getAppUserDataPath } from '../../lib/wrappedApp';
import * as fs from '../../lib/wrappedFs';
import { VRChatLogLineSchema } from './model';
import {
  appendLoglinesToFile,
  filterLogLinesByDate,
  getLegacyLogStoreFilePath,
  getLogStoreFilePathForDate,
  getLogStoreFilePathsInRange,
} from './service';

// getAppUserDataPathのモック
vi.mock('../../lib/wrappedApp', () => ({
  getAppUserDataPath: vi.fn().mockReturnValue('/mock/user/data'),
}));

// node:fsのモック
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn().mockReturnValue(undefined),
  readdirSync: vi.fn().mockReturnValue([]),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
  },
  statSync: vi.fn().mockReturnValue({ size: 100 }),
}));

// fs操作のモック
vi.mock('../../lib/wrappedFs', () => ({
  existsSyncSafe: vi.fn().mockReturnValue(false),
  mkdirSyncSafe: vi.fn().mockReturnValue(neverthrow.ok(undefined)),
  appendFileAsync: vi.fn().mockReturnValue(neverthrow.ok(undefined)),
  writeFileSyncSafe: vi.fn().mockReturnValue(neverthrow.ok(undefined)),
  unlinkAsync: vi.fn().mockReturnValue(neverthrow.ok(undefined)),
  readFileSyncSafe: vi.fn().mockImplementation(() => {
    return neverthrow.ok(Buffer.from('test content'));
  }),
  createReadStream: vi.fn().mockReturnValue({
    on: vi.fn().mockImplementation(function (
      this: unknown,
      event: string,
      callback: () => void,
    ) {
      if (event === 'data') {
        // 何もデータを返さない
      } else if (event === 'end') {
        callback();
      }
      return this;
    }),
    pipe: vi.fn().mockReturnThis(),
  }),
}));

describe('getLogStoreFilePathForDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppUserDataPath).mockReturnValue('/mock/user/data');
  });

  it('指定された日付に基づいて正しいパスを生成する', () => {
    const testDate = new Date('2024-05-15');
    const result = getLogStoreFilePathForDate(testDate);

    expect(result.value).toBe(
      path.join('/mock/user/data/logStore', '2024-05', 'logStore-2024-05.txt'),
    );
  });

  it('日付が指定されない場合は現在の日付を使用する', () => {
    // 現在の日付をモック
    const mockDate = new Date('2024-06-20');
    vi.setSystemTime(mockDate);

    try {
      const result = getLogStoreFilePathForDate(new Date());
      expect(result.value).toBe(
        path.join(
          '/mock/user/data/logStore',
          '2024-06',
          'logStore-2024-06.txt',
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getLogStoreFilePathsInRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppUserDataPath).mockReturnValue('/mock/user/data');
  });

  it('指定された日付からのログファイルパスを取得する', async () => {
    const startDate = new Date('2024-01-15');
    const mockDate = new Date('2024-03-20');
    vi.setSystemTime(mockDate);

    // 存在するファイルのみモック
    vi.mocked(nodeFs.existsSync).mockImplementation((path) => {
      const pathStr = typeof path === 'string' ? path : path.toString();
      return pathStr.includes('2024-02') || pathStr.includes('2024-03');
    });

    try {
      const result = await getLogStoreFilePathsInRange(startDate, mockDate);

      // 存在するファイルのみ返されることを確認（2024-02と2024-03のみ）
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(
        path.join(
          '/mock/user/data/logStore',
          '2024-02',
          'logStore-2024-02.txt',
        ),
      );
      expect(result[1].value).toBe(
        path.join(
          '/mock/user/data/logStore',
          '2024-03',
          'logStore-2024-03.txt',
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('startDateが指定されない場合は現在の日付のファイルのみを取得する', async () => {
    const mockDate = new Date('2024-04-10');
    vi.setSystemTime(mockDate);

    // 2024-04のファイルが存在することをモック
    vi.mocked(nodeFs.existsSync).mockImplementation((path) => {
      const pathStr = typeof path === 'string' ? path : path.toString();
      return pathStr.includes('2024-04');
    });

    try {
      const result = await getLogStoreFilePathsInRange(mockDate, mockDate);

      // 現在の月（2024-04）のパスのみが生成されることを確認
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(
        path.join(
          '/mock/user/data/logStore',
          '2024-04',
          'logStore-2024-04.txt',
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('appendLoglinesToFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSyncSafe).mockReturnValue(false);
  });

  it('ログを日付ごとに適切なファイルに分割して保存する', async () => {
    // 異なる月のログを用意
    const logLines = [
      VRChatLogLineSchema.parse('2024.01.15 12:00:00 Log entry 1'),
      VRChatLogLineSchema.parse('2024.01.20 15:30:00 Log entry 2'),
      VRChatLogLineSchema.parse('2024.02.05 10:15:00 Log entry 3'),
      VRChatLogLineSchema.parse('2024.02.10 18:45:00 Log entry 4'),
    ];

    const result = await appendLoglinesToFile({
      logLines,
    });

    expect(result.isOk()).toBe(true);

    // 2つの異なるディレクトリが作成されたことを確認
    expect(nodeFs.mkdirSync).toHaveBeenCalledTimes(4); // ルートディレクトリと月別ディレクトリの2つずつ
    expect(nodeFs.mkdirSync).toHaveBeenCalledWith(
      path.join('/mock/user/data/logStore', '2024-01'),
      { recursive: true },
    );
    expect(nodeFs.mkdirSync).toHaveBeenCalledWith(
      path.join('/mock/user/data/logStore', '2024-02'),
      { recursive: true },
    );

    // 2つの異なるファイルに書き込まれたことを確認
    expect(fs.writeFileSyncSafe).toHaveBeenCalledTimes(2);
    expect(fs.writeFileSyncSafe).toHaveBeenCalledWith(
      path.join('/mock/user/data/logStore', '2024-01', 'logStore-2024-01.txt'),
      '2024.01.15 12:00:00 Log entry 1\n2024.01.20 15:30:00 Log entry 2\n',
    );
    expect(fs.writeFileSyncSafe).toHaveBeenCalledWith(
      path.join('/mock/user/data/logStore', '2024-02', 'logStore-2024-02.txt'),
      '2024.02.05 10:15:00 Log entry 3\n2024.02.10 18:45:00 Log entry 4\n',
    );
  });

  it('ファイルサイズが上限を超えた場合は新しいファイルを作成する', async () => {
    const logLines = [
      VRChatLogLineSchema.parse('2024.03.15 12:00:00 Log entry 1'),
    ];

    // ファイルが存在すると仮定
    vi.mocked(fs.existsSyncSafe).mockReturnValue(true);

    // ファイルサイズが上限を超えていると仮定 (10MB以上)
    vi.mocked(nodeFs.statSync).mockReturnValue({
      size: 11 * 1024 * 1024, // 11MB
    } as ReturnType<typeof nodeFs.statSync>);

    // 現在の日時をモック
    const mockDate = new Date('2024-03-15T14:30:45');
    vi.setSystemTime(mockDate);

    // タイムスタンプ付きファイル名を予想される形式で設定
    const expectedFilePath = path.join(
      '/mock/user/data/logStore',
      '2024-03',
      'logStore-2024-03-20240315143045.txt',
    );

    try {
      const result = await appendLoglinesToFile({
        logLines,
      });

      expect(result.isOk()).toBe(true);

      // ディレクトリが作成されることを確認
      expect(nodeFs.mkdirSync).toHaveBeenCalledTimes(2); // ルートディレクトリと月別ディレクトリ

      // 新しいファイルに書き込まれたことを確認
      expect(fs.writeFileSyncSafe).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSyncSafe).toHaveBeenCalledWith(
        expectedFilePath,
        '2024.03.15 12:00:00 Log entry 1\n',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('vrchatLog service', () => {
  const mockUserDataPath = '/mock/user/data';
  const legacyLogPath = path.join(mockUserDataPath, 'logStore', 'logStore.txt');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppUserDataPath).mockReturnValue(mockUserDataPath);
  });

  describe('getLegacyLogStoreFilePath', () => {
    it('should return null when legacy file does not exist', async () => {
      vi.mocked(nodeFs.existsSync).mockReturnValue(false);
      const result = await getLegacyLogStoreFilePath();
      expect(result).toBeNull();
    });

    it('should return path when legacy file exists', async () => {
      vi.mocked(nodeFs.existsSync).mockReturnValue(true);
      const result = await getLegacyLogStoreFilePath();
      expect(result).not.toBeNull();
      expect(result?.value).toBe(legacyLogPath);
    });
  });

  describe('getLogStoreFilePathsInRange', () => {
    it('should include only existing files', async () => {
      // 特定のファイルのみ存在するとモック
      vi.mocked(nodeFs.existsSync).mockImplementation((path) => {
        // 2ヶ月前と現在の月のファイルのみ存在
        const pathStr = typeof path === 'string' ? path : path.toString();
        const twoMonthsAgo = datefns.format(
          datefns.subMonths(new Date(), 2),
          'yyyy-MM',
        );
        const currentMonth = datefns.format(new Date(), 'yyyy-MM');
        return pathStr.includes(twoMonthsAgo) || pathStr.includes(currentMonth);
      });

      // 3ヶ月前からのログを取得
      const startDate = datefns.subMonths(new Date(), 3);
      const currentDate = new Date();
      const paths = await getLogStoreFilePathsInRange(startDate, currentDate);

      // 存在するファイルのみ（2つ：2ヶ月前と現在の月）
      expect(paths.length).toBe(2);
    });

    it('should return empty array when no files exist', async () => {
      // すべてのファイルが存在しないとモック
      vi.mocked(nodeFs.existsSync).mockReturnValue(false);

      const startDate = datefns.subMonths(new Date(), 2);
      const currentDate = new Date();
      const paths = await getLogStoreFilePathsInRange(startDate, currentDate);

      // ファイルが存在しないので空の配列
      expect(paths.length).toBe(0);
    });
  });
});

describe('filterLogLinesByDate', () => {
  test('正しくログを日付でフィルタリングする', () => {
    // テスト用のログライン
    const logLines = [
      '2025.02.22 21:13:56 Debug      -  [Behaviour] Joining wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f:04307~region(jp)',
      '2025.02.22 21:13:56 Debug      -  [Behaviour] Joining or Creating Room: はじまりタウン ⁄ Dawnville',
      '2025.02.22 21:14:07 Debug      -  [Behaviour] OnPlayerJoined tkt (usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0)',
      '2025.02.22 21:14:48 Debug      -  [Behaviour] OnPlayerLeft tkt (usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0)',
      '2025.02.23 22:15:30 Debug      -  [Behaviour] Joining wrld_abcdef12-3456-7890-abcd-ef1234567890:12345',
      '2025.02.23 22:15:31 Debug      -  [Behaviour] Joining or Creating Room: テストワールド',
    ].map((line) => VRChatLogLineSchema.parse(line));

    // ケース1: すべてのログを含む日付（古い日付）
    const oldDate = datefns.parseISO('2025-02-21T00:00:00Z');
    const allLogs = filterLogLinesByDate(logLines, oldDate);
    expect(allLogs.length).toBe(6);

    // ケース2: 2日目のログのみを含む日付
    const midDate = datefns.parse(
      '2025-02-23 00:00:00',
      'yyyy-MM-dd HH:mm:ss',
      new Date(),
    );
    const day2Logs = filterLogLinesByDate(logLines, midDate);
    expect(day2Logs.length).toBe(2);
    expect(day2Logs[0]).toContain('2025.02.23');

    // ケース3: すべてのログを除外する日付（新しい日付）
    const futureDate = datefns.parseISO('2025-02-24T00:00:00Z');
    const noLogs = filterLogLinesByDate(logLines, futureDate);
    expect(noLogs.length).toBe(0);

    // ケース4: 特定の時刻以降のログのみを含む
    const specificTime = datefns.parse(
      '2025-02-22 21:14:00',
      'yyyy-MM-dd HH:mm:ss',
      new Date(),
    );
    const timeFilteredLogs = filterLogLinesByDate(logLines, specificTime);
    expect(timeFilteredLogs.length).toBe(4);
    expect(timeFilteredLogs[0]).toContain('21:14:07');
  });

  test('無効な日付形式のログ行を正しく処理する', () => {
    const logLines = [
      '2025.02.22 21:13:56 Debug      -  [Behaviour] Joining wrld_example:12345',
      'Invalid log format without date',
      '2025.13.32 25:61:99 Invalid date format',
    ].map((line) => VRChatLogLineSchema.parse(line));

    const startDate = datefns.parseISO('2025-01-01T00:00:00Z');
    const filteredLogs = filterLogLinesByDate(logLines, startDate);

    // 有効な日付形式のログだけがフィルタリングされる
    expect(filteredLogs.length).toBe(1);
    expect(filteredLogs[0]).toContain('2025.02.22');
  });

  test('同じ日付のログを含める', () => {
    const logDate = '2025.02.22 12:00:00';
    const logLines = [
      `${logDate} Debug      -  [Behaviour] Joining wrld_example:12345`,
    ].map((line) => VRChatLogLineSchema.parse(line));

    // ログと同じ日時
    const exactSameDate = datefns.parse(
      '2025-02-22 12:00:00',
      'yyyy-MM-dd HH:mm:ss',
      new Date(),
    );

    const filteredLogs = filterLogLinesByDate(logLines, exactSameDate);
    expect(filteredLogs.length).toBe(1);
  });
});

/**
 * 実際のファイルシステムを使用した統合テストは別ファイル（service.integration.test.ts）に
 * 実装しています。これにより、モックの設定がテスト間で干渉することを防ぎます。
 */
