import { describe, expect, it } from 'vitest';

import { mergeVRChatWorldJoinLogs } from './service';

describe('mergeVRChatWorldJoinLogs', () => {
  const baseDate = new Date('2024-01-01T00:00:00.000Z');

  it('通常のログと写真ログを正しくマージする', () => {
    const normalLogs = [
      {
        id: 'normal1',
        worldId: 'wrld_1',
        worldName: 'World 1',
        worldInstanceId: 'instance1',
        joinDateTime: baseDate,
        createdAt: baseDate,
        updatedAt: null,
      },
    ];

    const photoLogs = [
      {
        id: 'photo1',
        worldId: 'wrld_2',
        joinDate: new Date(baseDate.getTime() + 1000),
        createdAt: baseDate,
        updatedAt: null,
      },
    ];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(2);
    expect(result).toContainEqual(normalLogs[0]);
    expect(result).toContainEqual({
      id: 'photo1',
      worldId: 'wrld_2',
      worldName: 'wrld_2',
      worldInstanceId: '',
      joinDateTime: photoLogs[0].joinDate,
      createdAt: baseDate,
      updatedAt: null,
    });
  });

  it('重複するログの場合は通常のログを優先する', () => {
    const normalLogs = [
      {
        id: 'normal1',
        worldId: 'wrld_1',
        worldName: 'World 1',
        worldInstanceId: 'instance1',
        joinDateTime: baseDate,
        createdAt: baseDate,
        updatedAt: null,
      },
    ];

    const photoLogs = [
      {
        id: 'photo1',
        worldId: 'wrld_1',
        joinDate: baseDate,
        createdAt: baseDate,
        updatedAt: null,
      },
    ];

    const result = mergeVRChatWorldJoinLogs({ normalLogs, photoLogs });

    expect(result).toHaveLength(1);
    expect(result).toContainEqual(normalLogs[0]);
  });

  it('空の配列の場合は正しく処理する', () => {
    const result = mergeVRChatWorldJoinLogs({ normalLogs: [], photoLogs: [] });
    expect(result).toHaveLength(0);
  });
});
