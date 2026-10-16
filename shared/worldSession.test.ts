import { describe, expect, it } from 'vitest';

import {
  buildWorldSessions,
  findSessionStartingAt,
  resolveSession,
  resolveSessionIndex,
  type WorldSessionJoin,
} from './worldSession';

const join = (worldId: string, iso: string): WorldSessionJoin => ({
  worldId,
  joinDateTime: new Date(iso),
});

const at = (iso: string): Date => new Date(iso);

describe('buildWorldSessions', () => {
  it('空の入力からは空のセッション列を作る', () => {
    expect(buildWorldSessions([])).toEqual([]);
  });

  it('入力の並び順に関係なく古い順に並べ、次の参加日時を終端にする', () => {
    const w1 = join('wrld_1', '2024-01-01T10:00:00');
    const w2 = join('wrld_2', '2024-01-01T11:00:00');
    const w3 = join('wrld_3', '2024-01-01T12:00:00');

    const sessions = buildWorldSessions([w3, w1, w2]);

    expect(sessions.map((s) => s.join.worldId)).toEqual([
      'wrld_1',
      'wrld_2',
      'wrld_3',
    ]);
    expect(sessions[0].nextJoinDateTime).toEqual(w2.joinDateTime);
    expect(sessions[1].nextJoinDateTime).toEqual(w3.joinDateTime);
    expect(sessions[2].nextJoinDateTime).toBeUndefined();
  });

  it('同時刻の参加ログは worldId 順に並べ、入力順に依存しない', () => {
    const a = join('wrld_a', '2024-01-01T10:00:00');
    const b = join('wrld_b', '2024-01-01T10:00:00');

    const fromAB = buildWorldSessions([a, b]).map((s) => s.join.worldId);
    const fromBA = buildWorldSessions([b, a]).map((s) => s.join.worldId);

    expect(fromAB).toEqual(['wrld_a', 'wrld_b']);
    expect(fromBA).toEqual(fromAB);
  });
});

describe('resolveSessionIndex / resolveSession', () => {
  const sessions = buildWorldSessions([
    join('wrld_1', '2024-01-01T10:00:00'),
    join('wrld_2', '2024-01-01T11:00:00'),
    join('wrld_3', '2024-01-01T12:00:00'),
  ]);

  it('セッションが無いときは null を返す', () => {
    expect(resolveSessionIndex([], at('2024-01-01T10:00:00'))).toBeNull();
    expect(resolveSession([], at('2024-01-01T10:00:00'))).toBeNull();
  });

  it('最初の参加より前の時刻は null を返す', () => {
    expect(resolveSessionIndex(sessions, at('2024-01-01T09:59:59.999'))).toBe(
      null,
    );
  });

  it('参加時刻ちょうどはそのセッションに属する', () => {
    expect(resolveSessionIndex(sessions, at('2024-01-01T10:00:00'))).toBe(0);
  });

  it('次の参加時刻ちょうどは次のセッションに属する（許容誤差なし）', () => {
    expect(resolveSessionIndex(sessions, at('2024-01-01T10:59:59.999'))).toBe(
      0,
    );
    expect(resolveSessionIndex(sessions, at('2024-01-01T11:00:00'))).toBe(1);
  });

  it('最後のセッションは終わりを持たない', () => {
    expect(resolveSessionIndex(sessions, at('2030-01-01T00:00:00'))).toBe(2);
    expect(
      resolveSession(sessions, at('2030-01-01T00:00:00'))?.nextJoinDateTime,
    ).toBeUndefined();
  });

  it('同時刻の参加ログが複数あるときは後のセッションに属する', () => {
    const tied = buildWorldSessions([
      join('wrld_a', '2024-01-01T10:00:00'),
      join('wrld_b', '2024-01-01T10:00:00'),
      join('wrld_c', '2024-01-01T11:00:00'),
    ]);

    expect(resolveSession(tied, at('2024-01-01T10:00:00'))?.join.worldId).toBe(
      'wrld_b',
    );
    expect(resolveSession(tied, at('2024-01-01T10:30:00'))?.join.worldId).toBe(
      'wrld_b',
    );
    // 前側のセッションは [10:00, 10:00) となり、どの時刻も属さない
    expect(tied[0].nextJoinDateTime).toEqual(at('2024-01-01T10:00:00'));
  });

  it('写真由来の参加ログを含むマージ済みの入力も 1 本の時系列として扱う', () => {
    // 通常ログ（worldName あり）と写真由来ログ（worldName = worldId, instanceId 空）が混在する
    const merged = buildWorldSessions([
      {
        worldId: 'wrld_normal',
        worldName: 'Normal World',
        worldInstanceId: '12345',
        joinDateTime: at('2024-01-01T10:00:00'),
      },
      {
        worldId: 'wrld_photo',
        worldName: 'wrld_photo',
        worldInstanceId: '',
        joinDateTime: at('2024-01-01T10:30:00'),
      },
    ]);

    expect(
      resolveSession(merged, at('2024-01-01T10:20:00'))?.join.worldName,
    ).toBe('Normal World');
    expect(
      resolveSession(merged, at('2024-01-01T10:40:00'))?.join.worldInstanceId,
    ).toBe('');
  });

  it('多数のセッションで線形探索と同じ結果を返す', () => {
    // 疑似乱数（固定シード）で重複を含む参加時刻を作る
    let seed = 42;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    const base = new Date('2024-01-01T00:00:00').getTime();

    for (let round = 0; round < 20; round++) {
      const count = next() % 50;
      const joins = Array.from({ length: count }, (_, i) => ({
        worldId: `wrld_${i}`,
        joinDateTime: new Date(base + (next() % 100) * 1000),
      }));
      const built = buildWorldSessions(joins);

      for (let probe = -5; probe < 105; probe++) {
        const t = new Date(base + probe * 1000);
        let expected: number | null = null;
        for (const [i, session] of built.entries()) {
          const start = session.join.joinDateTime.getTime();
          const end = session.nextJoinDateTime?.getTime();
          if (
            start <= t.getTime() &&
            (end === undefined || t.getTime() < end)
          ) {
            expected = i;
          }
        }
        expect(resolveSessionIndex(built, t)).toBe(expected);
      }
    }
  });
});

describe('findSessionStartingAt', () => {
  const sessions = buildWorldSessions([
    join('wrld_1', '2024-01-01T10:00:00'),
    join('wrld_2', '2024-01-01T10:00:00.500'),
  ]);

  it('開始日時が一致するセッションを返す', () => {
    const session = findSessionStartingAt(sessions, at('2024-01-01T10:00:00'));
    expect(session?.join.worldId).toBe('wrld_1');
    expect(session?.nextJoinDateTime).toEqual(at('2024-01-01T10:00:00.500'));
  });

  it('セッションの途中の時刻では null を返す', () => {
    expect(
      findSessionStartingAt(sessions, at('2024-01-01T10:00:00.250')),
    ).toBeNull();
  });

  it('最初の参加より前の時刻では null を返す', () => {
    expect(
      findSessionStartingAt(sessions, at('2024-01-01T09:00:00')),
    ).toBeNull();
  });
});
