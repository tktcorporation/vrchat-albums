import { describe, expect, it } from 'vitest';

import { mergeVRChatWorldJoinLogs } from './service';

describe('mergeVRChatWorldJoinLogs', () => {
  const createNormalLog = (worldId: string, joinDateTime: Date) => ({
    id: `normal-${worldId}-${joinDateTime.getTime()}`,
    worldId,
    worldName: `World ${worldId}`,
    worldInstanceId: `instance-${worldId}`,
    joinDateTime,
    createdAt: new Date(),
    updatedAt: null,
  });

  const createPhotoLog = (worldId: string, joinDate: Date) => ({
    id: `photo-${worldId}-${joinDate.getTime()}`,
    worldId,
    joinDate,
    createdAt: new Date(),
    updatedAt: null,
  });

  it('通常ログのみの場合、そのまま返される', () => {
    const normalLogs = [
      createNormalLog('wrld_001', new Date('2024-01-01T10:00:00Z')),
      createNormalLog('wrld_002', new Date('2024-01-01T11:00:00Z')),
    ];
    const photoLogs: never[] = [];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(2);
    expect(result).toEqual(normalLogs);
  });

  it('写真ログのみの場合、変換されて返される', () => {
    const normalLogs: never[] = [];
    const photoLogs = [
      createPhotoLog('wrld_001', new Date('2024-01-01T10:00:00Z')),
      createPhotoLog('wrld_002', new Date('2024-01-01T11:00:00Z')),
    ];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(2);
    expect(result[0].worldId).toBe('wrld_001');
    expect(result[0].worldName).toBe('wrld_001'); // 写真からは取得できないのでworldIdと同じ
    expect(result[0].worldInstanceId).toBe(''); // 写真からは取得できない
    expect(result[0].joinDateTime).toEqual(photoLogs[0].joinDate);
  });

  it('重複がない場合、両方のログが含まれる', () => {
    const normalLogs = [
      createNormalLog('wrld_001', new Date('2024-01-01T10:00:00Z')),
    ];
    const photoLogs = [
      createPhotoLog('wrld_002', new Date('2024-01-01T11:00:00Z')),
    ];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(2);
    expect(result.find((log) => log.worldId === 'wrld_001')).toBeTruthy();
    expect(result.find((log) => log.worldId === 'wrld_002')).toBeTruthy();
  });

  it('同じワールドID・同じ時刻の場合、通常ログが優先される', () => {
    const sameTime = new Date('2024-01-01T10:00:00Z');
    const normalLogs = [createNormalLog('wrld_001', sameTime)];
    const photoLogs = [createPhotoLog('wrld_001', sameTime)];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(normalLogs[0].id);
    expect(result[0].worldName).toBe('World wrld_001'); // 通常ログの情報が保持される
    expect(result[0].worldInstanceId).toBe('instance-wrld_001');
  });

  it('同じワールドIDでも時刻が異なる場合、両方含まれる', () => {
    const normalLogs = [
      createNormalLog('wrld_001', new Date('2024-01-01T10:00:00Z')),
    ];
    const photoLogs = [
      createPhotoLog('wrld_001', new Date('2024-01-01T11:00:00Z')),
    ];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(2);
    expect(result.filter((log) => log.worldId === 'wrld_001')).toHaveLength(2);
  });

  it('複数の重複がある場合、すべて正しく処理される', () => {
    const normalLogs = [
      createNormalLog('wrld_001', new Date('2024-01-01T10:00:00Z')),
      createNormalLog('wrld_002', new Date('2024-01-01T11:00:00Z')),
      createNormalLog('wrld_003', new Date('2024-01-01T12:00:00Z')),
    ];
    const photoLogs = [
      createPhotoLog('wrld_001', new Date('2024-01-01T10:00:00Z')), // 重複
      createPhotoLog('wrld_002', new Date('2024-01-01T11:30:00Z')), // 時刻違い
      createPhotoLog('wrld_004', new Date('2024-01-01T13:00:00Z')), // 新規
    ];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(5); // 3(normal) + 2(photo, 1つは重複で除外)

    // wrld_001は1つのみ（通常ログ）
    const wrld001Logs = result.filter((log) => log.worldId === 'wrld_001');
    expect(wrld001Logs).toHaveLength(1);
    expect(wrld001Logs[0].worldName).toBe('World wrld_001');

    // wrld_002は2つ（時刻が違うため）
    const wrld002Logs = result.filter((log) => log.worldId === 'wrld_002');
    expect(wrld002Logs).toHaveLength(2);

    // wrld_004は写真ログのみ
    const wrld004Logs = result.filter((log) => log.worldId === 'wrld_004');
    expect(wrld004Logs).toHaveLength(1);
    expect(wrld004Logs[0].worldName).toBe('wrld_004'); // 写真ログなのでworldIdと同じ
  });
});
