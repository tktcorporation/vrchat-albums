import * as nodeFs from 'node:fs';
import path from 'node:path';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppUserDataPath } from '../../lib/wrappedApp';
import type { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import type { VRChatPlayerLeaveLogModel } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import * as playerLeaveLogService from '../VRChatPlayerLeaveLogModel/playerLeaveLog.service';
import { VRChatLogStoreFilePathSchema } from '../vrchatLog/model';
// import type { VRChatWorldJoinLog } from '../vrchatLog/service';
import * as vrchatLogService from '../vrchatLog/service';
import { VRChatPhotoDirPathSchema } from '../vrchatPhoto/valueObjects';
import * as vrchatPhotoService from '../vrchatPhoto/vrchatPhoto.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import type { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { loadLogInfoIndexFromVRChatLog } from './service';

// 必要最小限のモックを設定
vi.mock('../vrchatLog/service', () => ({
  importLogLinesFromLogPhotoDirPath: vi.fn().mockResolvedValue(undefined),
  getLogStoreFilePathsInRange: vi
    .fn()
    .mockImplementation(async (startDate, _currentDate) => {
      // 日付範囲に応じて複数のファイルパスを返すようにモックを修正
      const paths: ReturnType<typeof VRChatLogStoreFilePathSchema.parse>[] = [];
      let currentDate = new Date(startDate);
      const endDate = _currentDate || new Date();

      // 開始日から終了日まで1ヶ月ずつ増やしながらパスを生成
      while (
        datefns.isBefore(currentDate, endDate) ||
        datefns.isSameMonth(currentDate, endDate)
      ) {
        const yearMonth = datefns.format(currentDate, 'yyyy-MM');
        const mockPath = `/mock/user/data/logStore/${yearMonth}/logStore-${yearMonth}.txt`;
        paths.push(VRChatLogStoreFilePathSchema.parse(mockPath));
        currentDate = datefns.addMonths(currentDate, 1);
      }

      return paths;
    }),
  getVRChaLogInfoByLogFilePathList: vi.fn().mockImplementation(() => {
    return neverthrow.ok([]);
  }),
  getVRChaLogInfoByLogFilePathListWithPartialSuccess: vi
    .fn()
    .mockImplementation(() => {
      return neverthrow.okAsync({
        data: [],
        errors: [],
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
      });
    }),
  getLegacyLogStoreFilePath: vi.fn().mockImplementation(async () => {
    // モックでレガシーファイルパスを返す
    const legacyPath = path.join('/mock/user/data/logStore', 'logStore.txt');
    // レガシーファイルが存在する場合のみパスを返す
    if (vi.mocked(nodeFs.existsSync).mock.results[0]?.value === true) {
      return VRChatLogStoreFilePathSchema.parse(legacyPath);
    }
    return null;
  }),
}));

vi.mock('../vrchatWorldJoinLog/service', () => ({
  findLatestWorldJoinLog: vi.fn().mockReturnValue(neverthrow.okAsync(null)),
  createVRChatWorldJoinLogModel: vi
    .fn()
    .mockReturnValue(neverthrow.okAsync([])),
}));

vi.mock('../VRChatPlayerJoinLogModel/playerJoinLog.service', () => ({
  findLatestPlayerJoinLog: vi.fn().mockResolvedValue(neverthrow.ok(null)),
  createVRChatPlayerJoinLogModel: vi.fn().mockResolvedValue([]),
}));

vi.mock('../VRChatPlayerLeaveLogModel/playerLeaveLog.service', () => ({
  findLatestPlayerLeaveLog: vi.fn().mockResolvedValue(null),
  createVRChatPlayerLeaveLogModel: vi.fn().mockResolvedValue([]),
}));

vi.mock('../vrchatPhoto/vrchatPhoto.service', () => ({
  getVRChatPhotoDirPath: vi.fn().mockResolvedValue({ value: '/mock/photos' }),
  getLatestPhotoDate: vi.fn().mockResolvedValue(null),
  createVRChatPhotoPathIndex: vi.fn().mockResolvedValue([]),
}));

// getAppUserDataPathのモック
vi.mock('../../lib/wrappedApp', () => ({
  getAppUserDataPath: vi.fn().mockReturnValue('/mock/user/data'),
}));

// node:fsのモック
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
  },
  statSync: vi.fn().mockReturnValue({ size: 100 }),
}));

describe('loadLogInfoIndexFromVRChatLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppUserDataPath).mockReturnValue('/mock/user/data');
  });

  it('DBに記録がない場合は1年前からログを取得する', async () => {
    const mockDate = new Date('2024-03-15');
    vi.setSystemTime(mockDate);

    try {
      const result = await loadLogInfoIndexFromVRChatLog({
        excludeOldLogLoad: true,
      });

      expect(result.isOk()).toBe(true);

      // getLogStoreFilePathsInRangeが適切な引数で呼ばれたか確認
      // const _oneYearAgo = datefns.subYears(mockDate, 1);
      expect(vrchatLogService.getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );

      // 1年前の日付が含まれているか検証
      const startDateArg = vi.mocked(
        vrchatLogService.getLogStoreFilePathsInRange,
      ).mock.calls[0][0];
      const startDateYear = startDateArg.getFullYear();
      const startDateMonth = startDateArg.getMonth();

      expect(startDateYear).toBe(2023);
      expect(startDateMonth).toBe(2); // 3月は0-indexed で 2
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludeOldLogLoadがfalseの場合は2000年1月1日からすべてのログを取得する', async () => {
    const mockDate = new Date('2024-03-15');
    vi.setSystemTime(mockDate);

    try {
      const result = await loadLogInfoIndexFromVRChatLog({
        excludeOldLogLoad: false,
      });

      expect(result.isOk()).toBe(true);

      // getLogStoreFilePathsInRangeが適切な引数で呼ばれたか確認
      expect(vrchatLogService.getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );

      // 開始日が2000年1月1日になっているか検証
      const startDateArg = vi.mocked(
        vrchatLogService.getLogStoreFilePathsInRange,
      ).mock.calls[0][0];
      expect(startDateArg.getFullYear()).toBe(2000);
      expect(startDateArg.getMonth()).toBe(0); // 1月は0-indexed で 0
      expect(startDateArg.getDate()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludeOldLogLoadがfalseの場合、レガシーファイルが存在すれば読み込む', async () => {
    const mockDate = new Date('2024-03-15');
    vi.setSystemTime(mockDate);

    // レガシーファイルが存在すると仮定
    vi.mocked(nodeFs.existsSync).mockReturnValue(true);

    // モック関数をカスタマイズしてこのテストだけレガシーファイルパスを返すようにする
    const legacyPath = path.join('/mock/user/data/logStore', 'logStore.txt');
    const legacyFilePath = VRChatLogStoreFilePathSchema.parse(legacyPath);
    const mockGetLegacyLogStoreFilePath = vi
      .fn()
      .mockResolvedValue(legacyFilePath);
    vi.mocked(vrchatLogService.getLegacyLogStoreFilePath).mockImplementation(
      mockGetLegacyLogStoreFilePath,
    );

    // このテスト用にgetVRChaLogInfoByLogFilePathListをカスタマイズ
    vi.mocked(
      vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
    ).mockImplementation((paths) => {
      // パスにlegacyPathが含まれていることを確認するためのカスタムモック
      expect(paths.some((p) => p.value === legacyPath)).toBe(true);
      return neverthrow.okAsync({
        data: [],
        errors: [],
        totalProcessed: paths.length,
        successCount: paths.length,
        errorCount: 0,
      });
    });

    try {
      const result = await loadLogInfoIndexFromVRChatLog({
        excludeOldLogLoad: false,
      });

      expect(result.isOk()).toBe(true);

      // getLegacyLogStoreFilePathが呼ばれたか確認
      expect(vrchatLogService.getLegacyLogStoreFilePath).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ログファイルパスが正しく生成されていることを確認する', async () => {
    const mockDate = new Date('2024-03-15');
    vi.setSystemTime(mockDate);

    // レガシーファイルのモックをリセット（このテストではレガシーファイルは不要）
    vi.mocked(nodeFs.existsSync).mockReturnValue(false);
    vi.mocked(vrchatLogService.getLegacyLogStoreFilePath).mockResolvedValue(
      null,
    );

    // getVRChaLogInfoByLogFilePathListのモックをリセット
    vi.mocked(
      vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
    ).mockImplementation(() => {
      return neverthrow.okAsync({
        data: [],
        errors: [],
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
      });
    });

    // テスト用にgetLogStoreFilePathsInRangeの実装を修正してパスを記録
    const generatedPaths: string[] = [];
    vi.mocked(vrchatLogService.getLogStoreFilePathsInRange).mockImplementation(
      async (startDate, _currentDate) => {
        // 日付範囲に応じて複数のファイルパスを返すようにモック
        const paths: ReturnType<typeof VRChatLogStoreFilePathSchema.parse>[] =
          [];
        let currentDate = new Date(startDate);
        const endDate = _currentDate || new Date();

        // 開始日から終了日まで1ヶ月ずつ増やしながらパスを生成
        while (
          datefns.isBefore(currentDate, endDate) ||
          datefns.isSameMonth(currentDate, endDate)
        ) {
          const yearMonth = datefns.format(currentDate, 'yyyy-MM');
          const mockPath = `/mock/user/data/logStore/${yearMonth}/logStore-${yearMonth}.txt`;
          generatedPaths.push(mockPath); // 生成したパスを記録
          paths.push(VRChatLogStoreFilePathSchema.parse(mockPath));
          currentDate = datefns.addMonths(currentDate, 1);
        }

        return paths;
      },
    );

    try {
      const result = await loadLogInfoIndexFromVRChatLog({
        excludeOldLogLoad: true,
      });

      expect(result.isOk()).toBe(true);

      // 生成されたパスが想定通りか検証
      expect(generatedPaths.length).toBeGreaterThan(0);

      // 1年前（2023-03）から現在（2024-03）までのパスが生成されていることを確認
      expect(generatedPaths).toContain(
        '/mock/user/data/logStore/2023-03/logStore-2023-03.txt',
      );
      expect(generatedPaths).toContain(
        '/mock/user/data/logStore/2024-03/logStore-2024-03.txt',
      );

      // 月ごとのファイルパスが連続して生成されているか確認
      const expectedMonths = [
        '2023-03',
        '2023-04',
        '2023-05',
        '2023-06',
        '2023-07',
        '2023-08',
        '2023-09',
        '2023-10',
        '2023-11',
        '2023-12',
        '2024-01',
        '2024-02',
        '2024-03',
      ];

      for (const month of expectedMonths) {
        const expectedPath = `/mock/user/data/logStore/${month}/logStore-${month}.txt`;
        expect(generatedPaths).toContain(expectedPath);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludeOldLogLoadがfalseのとき、2000年1月から現在までの全パスが生成される', async () => {
    const mockDate = new Date('2024-03-15');
    vi.setSystemTime(mockDate);

    // レガシーファイルのモックをリセット（このテストではレガシーファイルの確認は別で行っている）
    vi.mocked(nodeFs.existsSync).mockReturnValue(false);
    vi.mocked(vrchatLogService.getLegacyLogStoreFilePath).mockResolvedValue(
      null,
    );

    // getVRChaLogInfoByLogFilePathListのモックをリセット
    vi.mocked(
      vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
    ).mockImplementation(() => {
      return neverthrow.okAsync({
        data: [],
        errors: [],
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
      });
    });

    // テスト用にgetLogStoreFilePathsInRangeの実装を修正してパスを記録
    const generatedPaths: string[] = [];
    vi.mocked(vrchatLogService.getLogStoreFilePathsInRange).mockImplementation(
      async (startDate, _currentDate) => {
        // startDateが2000-01-01であることを検証
        expect(startDate.getFullYear()).toBe(2000);
        expect(startDate.getMonth()).toBe(0);
        expect(startDate.getDate()).toBe(1);

        // 簡略化のため、最初の月と最後の月だけを含める
        const paths: ReturnType<typeof VRChatLogStoreFilePathSchema.parse>[] =
          [];

        // 開始月（2000-01）
        const startYearMonth = '2000-01';
        const startMonthPath = `/mock/user/data/logStore/${startYearMonth}/logStore-${startYearMonth}.txt`;
        generatedPaths.push(startMonthPath);
        paths.push(VRChatLogStoreFilePathSchema.parse(startMonthPath));

        // 現在の月（2024-03）
        const endYearMonth = '2024-03';
        const endMonthPath = `/mock/user/data/logStore/${endYearMonth}/logStore-${endYearMonth}.txt`;
        generatedPaths.push(endMonthPath);
        paths.push(VRChatLogStoreFilePathSchema.parse(endMonthPath));

        return paths;
      },
    );

    try {
      const result = await loadLogInfoIndexFromVRChatLog({
        excludeOldLogLoad: false,
      });

      expect(result.isOk()).toBe(true);

      // 生成されたパスが想定通りか検証
      expect(generatedPaths).toContain(
        '/mock/user/data/logStore/2000-01/logStore-2000-01.txt',
      );
      expect(generatedPaths).toContain(
        '/mock/user/data/logStore/2024-03/logStore-2024-03.txt',
      );

      // 古いパスから新しいパスまでの範囲全体をカバーしていることを確認
      expect(vrchatLogService.getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.objectContaining({
          getFullYear: expect.any(Function),
          getMonth: expect.any(Function),
          getDate: expect.any(Function),
        }),
        expect.any(Date),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// 新しい describe ブロックを追加
describe('_getLogStoreFilePaths behavior within loadLogInfoIndexFromVRChatLog', () => {
  const legacyLogPath = VRChatLogStoreFilePathSchema.parse(
    '/mock/user/data/logStore/logStore.txt',
  );
  const rangeLogPath1 = VRChatLogStoreFilePathSchema.parse(
    '/mock/user/data/logStore/2024-01/logStore-2024-01.txt',
  );
  const rangeLogPath2 = VRChatLogStoreFilePathSchema.parse(
    '/mock/user/data/logStore/2024-02/logStore-2024-02.txt',
  );

  beforeEach(() => {
    // 各テストの前にモックの状態をリセット
    vi.clearAllMocks(); // 既存のモックもクリア
    vi.mocked(getAppUserDataPath).mockReturnValue('/mock/user/data');

    // _getLogStoreFilePaths の依存関係のモックを再設定
    vi.mocked(worldJoinLogService.findLatestWorldJoinLog).mockReturnValue(
      neverthrow.okAsync(null),
    );
    vi.mocked(playerJoinLogService.findLatestPlayerJoinLog).mockResolvedValue(
      neverthrow.ok(null),
    );
    vi.mocked(playerLeaveLogService.findLatestPlayerLeaveLog).mockResolvedValue(
      null,
    );
    vi.mocked(vrchatLogService.getLegacyLogStoreFilePath).mockResolvedValue(
      legacyLogPath,
    );
    vi.mocked(vrchatLogService.getLogStoreFilePathsInRange).mockResolvedValue([
      rangeLogPath1,
      rangeLogPath2,
    ]);
    // getVRChaLogInfoByLogFilePathList は空の成功結果を返すように設定
    vi.mocked(
      vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
    ).mockImplementation(() =>
      neverthrow.okAsync({
        data: [],
        errors: [],
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
      }),
    );
    // 写真関連のモックも設定（必要に応じて）
    vi.mocked(vrchatPhotoService.getVRChatPhotoDirPath).mockResolvedValue(
      VRChatPhotoDirPathSchema.parse('/mock/photos'),
    );
    vi.mocked(
      vrchatLogService.importLogLinesFromLogPhotoDirPath,
    ).mockResolvedValue(undefined);
    vi.mocked(vrchatPhotoService.getLatestPhotoDate).mockResolvedValue(null);
    vi.mocked(vrchatPhotoService.createVRChatPhotoPathIndex).mockResolvedValue(
      [],
    );
    // node:fs の existsSync をデフォルトで false に
    vi.mocked(nodeFs.existsSync).mockReturnValue(false);
  });

  it('excludeOldLogLoad が true の場合、legacyLogStoreFilePath を取得せず、range のみ取得する', async () => {
    const mockDate = new Date('2024-02-15');
    vi.setSystemTime(mockDate);
    const oneYearAgo = datefns.subYears(mockDate, 1);

    try {
      await loadLogInfoIndexFromVRChatLog({ excludeOldLogLoad: true });

      expect(vrchatLogService.getLegacyLogStoreFilePath).not.toHaveBeenCalled();
      expect(vrchatLogService.getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );
      // DBにログがない場合、開始日は1年前になるはず
      const startDateArg = vi.mocked(
        vrchatLogService.getLogStoreFilePathsInRange,
      ).mock.calls[0][0];
      expect(datefns.isEqual(startDateArg, oneYearAgo)).toBe(true);

      // getVRChaLogInfoByLogFilePathList に渡されるパスを確認
      expect(
        vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
      ).toHaveBeenCalledWith([rangeLogPath1, rangeLogPath2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludeOldLogLoad が false で legacy が存在する場合、legacy と range の両方を取得する', async () => {
    const mockDate = new Date('2024-02-15');
    vi.setSystemTime(mockDate);
    const expectedStartDate = datefns.parseISO('2000-01-01');
    // レガシーファイルが存在すると仮定
    vi.mocked(nodeFs.existsSync).mockReturnValue(true); // このテストケースでは true にする
    vi.mocked(vrchatLogService.getLegacyLogStoreFilePath).mockResolvedValue(
      legacyLogPath,
    );

    try {
      await loadLogInfoIndexFromVRChatLog({ excludeOldLogLoad: false });

      expect(vrchatLogService.getLegacyLogStoreFilePath).toHaveBeenCalled();
      expect(vrchatLogService.getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );
      // 開始日が2000-01-01であることを確認
      const startDateArg = vi.mocked(
        vrchatLogService.getLogStoreFilePathsInRange,
      ).mock.calls[0][0];
      expect(datefns.isEqual(startDateArg, expectedStartDate)).toBe(true);

      // getVRChaLogInfoByLogFilePathList に渡されるパスを確認 (legacy + range)
      expect(
        vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
      ).toHaveBeenCalledWith([legacyLogPath, rangeLogPath1, rangeLogPath2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludeOldLogLoad が false で legacy が存在しない場合、range のみ取得する', async () => {
    const mockDate = new Date('2024-02-15');
    vi.setSystemTime(mockDate);
    const expectedStartDate = datefns.parseISO('2000-01-01');
    // レガシーファイルが存在しないと仮定
    vi.mocked(nodeFs.existsSync).mockReturnValue(false); // false (デフォルトのまま)
    vi.mocked(vrchatLogService.getLegacyLogStoreFilePath).mockResolvedValue(
      null,
    ); // null を返すように設定

    try {
      await loadLogInfoIndexFromVRChatLog({ excludeOldLogLoad: false });

      expect(vrchatLogService.getLegacyLogStoreFilePath).toHaveBeenCalled(); // 呼ばれるが null が返る
      expect(vrchatLogService.getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );
      // 開始日が2000-01-01であることを確認
      const startDateArg = vi.mocked(
        vrchatLogService.getLogStoreFilePathsInRange,
      ).mock.calls[0][0];
      expect(datefns.isEqual(startDateArg, expectedStartDate)).toBe(true);

      // getVRChaLogInfoByLogFilePathList に渡されるパスを確認 (range のみ)
      expect(
        vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
      ).toHaveBeenCalledWith([rangeLogPath1, rangeLogPath2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludeOldLogLoad が true で DB に最新ログがある場合、その日付以降の range のみ取得する', async () => {
    const mockDate = new Date('2024-02-15');
    vi.setSystemTime(mockDate);

    const latestWorldJoinDate = datefns.subDays(mockDate, 5); // 2024-02-10
    const latestPlayerJoinDate = datefns.subDays(mockDate, 3); // 2024-02-12 (最新)
    const latestPlayerLeaveDate = datefns.subDays(mockDate, 7); // 2024-02-08

    // このテストケース用にモックを上書き
    vi.mocked(worldJoinLogService.findLatestWorldJoinLog).mockReturnValue(
      neverthrow.okAsync({
        joinDateTime: latestWorldJoinDate,
      } as VRChatWorldJoinLogModel),
    );
    vi.mocked(playerJoinLogService.findLatestPlayerJoinLog).mockResolvedValue(
      neverthrow.ok({
        joinDateTime: latestPlayerJoinDate,
      } as VRChatPlayerJoinLogModel), // as any で型チェックを回避
    );
    vi.mocked(playerLeaveLogService.findLatestPlayerLeaveLog).mockResolvedValue(
      {
        leaveDateTime: latestPlayerLeaveDate,
      } as VRChatPlayerLeaveLogModel,
    ); // as any で型チェックを回避

    try {
      await loadLogInfoIndexFromVRChatLog({ excludeOldLogLoad: true });

      expect(vrchatLogService.getLegacyLogStoreFilePath).not.toHaveBeenCalled();
      expect(vrchatLogService.getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.any(Date), // latestPlayerJoinDate が渡されるはず
        expect.any(Date),
      );

      // 開始日が latestPlayerJoinDate であることを確認
      const startDateArg = vi.mocked(
        vrchatLogService.getLogStoreFilePathsInRange,
      ).mock.calls[0][0];
      expect(datefns.isEqual(startDateArg, latestPlayerJoinDate)).toBe(true);

      // getVRChaLogInfoByLogFilePathList に渡されるパスを確認 (range のみ)
      expect(
        vrchatLogService.getVRChaLogInfoByLogFilePathListWithPartialSuccess,
      ).toHaveBeenCalledWith([rangeLogPath1, rangeLogPath2]); // モックの rangeLogPath が渡される
    } finally {
      vi.useRealTimers();
    }
  });
});

// getFrequentPlayerNames のテストは実際のデータベース接続が必要なため、
// 統合テストとして logInfoCointroller.test.ts に移動しました。
// ここではコメントアウトしておきます。

// describe('getFrequentPlayerNames', () => {
//   beforeEach(async () => {
//     // データベースをクリア
//     const { VRChatPlayerJoinLogModel } = await import('../VRChatPlayerJoinLogModel/playerJoinInfoLog.model');
//     await VRChatPlayerJoinLogModel.destroy({ where: {} });
//   });
//
//   it('プレイヤー参加ログから頻度順に上位プレイヤー名を取得する', async () => {
//     // テストデータの準備
//     const { VRChatPlayerJoinLogModel } = await import('../VRChatPlayerJoinLogModel/playerJoinInfoLog.model');
//     await VRChatPlayerJoinLogModel.bulkCreate([
//       {
//         playerName: 'Player1',
//         joinDateTime: new Date('2024-01-01'),
//         playerId: 'id1',
//       },
//       {
//         playerName: 'Player1',
//         joinDateTime: new Date('2024-01-02'),
//         playerId: 'id1',
//       },
//       {
//         playerName: 'Player1',
//         joinDateTime: new Date('2024-01-03'),
//         playerId: 'id1',
//       },
//       {
//         playerName: 'Player2',
//         joinDateTime: new Date('2024-01-01'),
//         playerId: 'id2',
//       },
//       {
//         playerName: 'Player2',
//         joinDateTime: new Date('2024-01-02'),
//         playerId: 'id2',
//       },
//       {
//         playerName: 'Player3',
//         joinDateTime: new Date('2024-01-01'),
//         playerId: 'id3',
//       },
//     ]);
//
//     // getFrequentPlayerNames をインポートしてテスト
//     const { getFrequentPlayerNames } = await import('./service');
//     const result = await getFrequentPlayerNames(3);
//
//     // 頻度順（Player1: 3回, Player2: 2回, Player3: 1回）で返されることを確認
//     expect(result).toEqual(['Player1', 'Player2', 'Player3']);
//   });
//
//   it('limitパラメータが機能することを確認', async () => {
//     // 5人のプレイヤーデータを作成
//     const { VRChatPlayerJoinLogModel } = await import('../VRChatPlayerJoinLogModel/playerJoinInfoLog.model');
//     await VRChatPlayerJoinLogModel.bulkCreate([
//       { playerName: 'Player1', joinDateTime: new Date('2024-01-01'), playerId: 'id1' },
//       { playerName: 'Player1', joinDateTime: new Date('2024-01-02'), playerId: 'id1' },
//       { playerName: 'Player1', joinDateTime: new Date('2024-01-03'), playerId: 'id1' },
//       { playerName: 'Player1', joinDateTime: new Date('2024-01-04'), playerId: 'id1' },
//       { playerName: 'Player1', joinDateTime: new Date('2024-01-05'), playerId: 'id1' },
//
//       { playerName: 'Player2', joinDateTime: new Date('2024-01-01'), playerId: 'id2' },
//       { playerName: 'Player2', joinDateTime: new Date('2024-01-02'), playerId: 'id2' },
//       { playerName: 'Player2', joinDateTime: new Date('2024-01-03'), playerId: 'id2' },
//       { playerName: 'Player2', joinDateTime: new Date('2024-01-04'), playerId: 'id2' },
//
//       { playerName: 'Player3', joinDateTime: new Date('2024-01-01'), playerId: 'id3' },
//       { playerName: 'Player3', joinDateTime: new Date('2024-01-02'), playerId: 'id3' },
//       { playerName: 'Player3', joinDateTime: new Date('2024-01-03'), playerId: 'id3' },
//
//       { playerName: 'Player4', joinDateTime: new Date('2024-01-01'), playerId: 'id4' },
//       { playerName: 'Player4', joinDateTime: new Date('2024-01-02'), playerId: 'id4' },
//
//       { playerName: 'Player5', joinDateTime: new Date('2024-01-01'), playerId: 'id5' },
//     ]);
//
//     const { getFrequentPlayerNames } = await import('./service');
//
//     // 上位2名のみ取得
//     const result = await getFrequentPlayerNames(2);
//
//     expect(result).toHaveLength(2);
//     expect(result).toEqual(['Player1', 'Player2']);
//   });
//
//   it('プレイヤーログが存在しない場合は空配列を返す', async () => {
//     const { getFrequentPlayerNames } = await import('./service');
//     const result = await getFrequentPlayerNames(5);
//
//     expect(result).toEqual([]);
//   });
//
//   it('同じ頻度のプレイヤーがいる場合でも正しく処理される', async () => {
//     // 同じ頻度のプレイヤーデータを作成
//     const { VRChatPlayerJoinLogModel } = await import('../VRChatPlayerJoinLogModel/playerJoinInfoLog.model');
//     await VRChatPlayerJoinLogModel.bulkCreate([
//       { playerName: 'PlayerA', joinDateTime: new Date('2024-01-01'), playerId: 'idA' },
//       { playerName: 'PlayerA', joinDateTime: new Date('2024-01-02'), playerId: 'idA' },
//
//       { playerName: 'PlayerB', joinDateTime: new Date('2024-01-01'), playerId: 'idB' },
//       { playerName: 'PlayerB', joinDateTime: new Date('2024-01-02'), playerId: 'idB' },
//
//       { playerName: 'PlayerC', joinDateTime: new Date('2024-01-01'), playerId: 'idC' },
//     ]);
//
//     const { getFrequentPlayerNames } = await import('./service');
//     const result = await getFrequentPlayerNames(3);
//
//     expect(result).toHaveLength(3);
//     expect(result).toContain('PlayerA');
//     expect(result).toContain('PlayerB');
//     expect(result).toContain('PlayerC');
//     // PlayerAとPlayerBは同じ頻度なので順序は不定だが、両方含まれている
//     expect(result.slice(0, 2)).toEqual(expect.arrayContaining(['PlayerA', 'PlayerB']));
//     expect(result[2]).toBe('PlayerC');
//   });
// });
