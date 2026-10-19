import * as datefns from 'date-fns';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVRChatWorldJoinLogFromPhoto } from '../../vrchatWorldJoinLogFromPhoto/service';
import { importLogLinesFromPhotoPaths } from './photoLogImporter';

vi.mock('../../vrchatWorldJoinLogFromPhoto/service', () => ({
  createVRChatWorldJoinLogFromPhoto: vi.fn().mockResolvedValue([]),
}));

describe('importLogLinesFromPhotoPaths', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('ファイル名からワールドIDと参加日時を読めるパスだけを保存する', async () => {
    const worldId = 'wrld_12345678-1234-1234-1234-123456789abc';
    await importLogLinesFromPhotoPaths({
      photoPaths: [
        `/photos/2024-01/VRChat_2024-01-05_10-20-30.123_${worldId}.png`,
        `/photos/2024-02/nested/VRChat_2024-02-06_11-00-00.000_${worldId}.jpg`,
        // 日時の形が合わない
        `/photos/2024-01/VRChat_2024-01-05_${worldId}.png`,
        // ワールドIDが UUID の形でない
        '/photos/2024-01/VRChat_2024-01-05_10-20-30.123_wrld_invalid.png',
      ],
    });

    expect(createVRChatWorldJoinLogFromPhoto).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(createVRChatWorldJoinLogFromPhoto).mock.calls[0][0],
    ).toEqual([
      {
        worldId,
        // ファイル名の日時はローカルタイム
        joinDate: datefns.parse(
          '2024-01-05_10-20-30.123',
          'yyyy-MM-dd_HH-mm-ss.SSS',
          new Date(),
        ),
      },
      {
        worldId,
        joinDate: datefns.parse(
          '2024-02-06_11-00-00.000',
          'yyyy-MM-dd_HH-mm-ss.SSS',
          new Date(),
        ),
      },
    ]);
  });

  it('パスが無ければ空の配列で保存処理を呼ぶ', async () => {
    await importLogLinesFromPhotoPaths({ photoPaths: [] });

    expect(createVRChatWorldJoinLogFromPhoto).toHaveBeenCalledWith([]);
  });
});
