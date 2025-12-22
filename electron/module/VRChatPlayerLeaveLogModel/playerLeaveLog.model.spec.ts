import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as client from '../../lib/sequelize';
import { type getSettingStore, initSettingStoreForTest } from '../settingStore';
import {
  getVRChaLogInfoFromLogPath,
  type VRChatPlayerLeaveLog,
} from '../vrchatLog/service';
import { getValidVRChatLogFileDir } from '../vrchatLogFileDir/service';
import * as model from './playerLeaveLog.service';

describe('module/VRChatPlayerLeaveLogModel', () => {
  beforeAll(async () => {
    client.__initTestRDBClient();
    // migrate db
    await client.syncRDBClient({
      checkRequired: false,
    });
  }, 10000);

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  it('creates and reads leave logs', async () => {
    const storedVRChatLogFilesDirPath = {
      value: path.join(process.cwd(), 'debug', 'logs'),
    };
    initSettingStoreForTest({
      getLogFilesDir: () => storedVRChatLogFilesDirPath.value,
    } as unknown as ReturnType<typeof getSettingStore>);

    const logFilesDirPath = await getValidVRChatLogFileDir();
    if (logFilesDirPath.isErr()) {
      throw new Error('Unexpected error');
    }

    const logInfoList = await getVRChaLogInfoFromLogPath(
      logFilesDirPath.value.path,
    );
    if (logInfoList.isErr()) {
      throw new Error('Unexpected error');
    }

    const leaveLogList = logInfoList.value.filter(
      (logInfo): logInfo is VRChatPlayerLeaveLog =>
        logInfo.logType === 'playerLeave',
    );
    console.log(leaveLogList);

    // 退出ログの作成をテスト
    const createdLogs =
      await model.createVRChatPlayerLeaveLogModel(leaveLogList);
    expect(createdLogs.length).toBeGreaterThan(0);

    // 最新の退出ログを取得してテスト
    const latestLog = await model.findLatestPlayerLeaveLog();
    expect(latestLog).not.toBeNull();
    if (latestLog) {
      expect(latestLog.playerName).toBeDefined();
      expect(latestLog.playerId).toBeDefined();
      expect(latestLog.leaveDateTime).toBeInstanceOf(Date);
    }

    // 日時でフィルタリングしたリストの取得をテスト
    const filteredLogs = await model.findVRChatPlayerLeaveLogList({
      gtLeaveDateTime: new Date(2020, 0, 1),
      orderByLeaveDateTime: 'desc',
    });
    expect(Array.isArray(filteredLogs)).toBe(true);
  });
});
