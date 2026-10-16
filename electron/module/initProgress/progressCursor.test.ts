import { describe, expect, it } from 'vitest';

import { advanceProgressCursor } from './progressCursor';

describe('advanceProgressCursor', () => {
  it('最初の進捗はそのまま受け付ける', () => {
    expect(advanceProgressCursor(null, 'log_append', 30)).toEqual({
      kind: 'accept',
      cursor: { stageIndex: 1, progress: 30 },
    });
  });

  it('同じステージで小さい進捗が来たら前回値に切り上げる', () => {
    const decision = advanceProgressCursor(
      { stageIndex: 2, progress: 60 },
      'log_load',
      0,
    );
    expect(decision).toEqual({
      kind: 'accept',
      cursor: { stageIndex: 2, progress: 60 },
    });
  });

  it('先のステージは途中を飛ばしても受け付け、進捗はそのステージの値になる', () => {
    expect(
      advanceProgressCursor({ stageIndex: 0, progress: 100 }, 'photo_index', 0),
    ).toEqual({ kind: 'accept', cursor: { stageIndex: 3, progress: 0 } });
  });

  it('前のステージは受け付けない', () => {
    const cursor = { stageIndex: 3, progress: 20 };
    expect(advanceProgressCursor(cursor, 'log_load', 100)).toEqual({
      kind: 'reject_backward',
      cursor,
    });
  });

  it('進捗を 0-100 の整数に丸める', () => {
    expect(advanceProgressCursor(null, 'database_sync', 150).cursor).toEqual({
      stageIndex: 0,
      progress: 100,
    });
    expect(advanceProgressCursor(null, 'database_sync', 33.6).cursor).toEqual({
      stageIndex: 0,
      progress: 34,
    });
  });
});
