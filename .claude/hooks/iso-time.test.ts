/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { formatIsoUtc, nowMs, parseIsoUtcMs } from './iso-time.ts';

type TemporalLike = { Instant: { from(value: string): { epochMilliseconds: number } } };
// Bun 1.4 未満には Temporal が無いので、ある環境でだけ照合する。
const temporal: TemporalLike | undefined = Reflect.get(globalThis, 'Temporal');

describe('iso-time', () => {
  test('既知の時刻をエポックのミリ秒へ変換する', () => {
    expect(parseIsoUtcMs('1970-01-01T00:00:00Z')).toBe(0);
    expect(parseIsoUtcMs('2000-02-29T12:34:56.7Z')).toBe(951_827_696_700);
    expect(parseIsoUtcMs('2026-09-23T00:00:07.123Z')).toBe(1_790_121_607_123);
    expect(parseIsoUtcMs('1969-12-31T23:59:59.999Z')).toBe(-1);
  });

  test('存在しない日時と別の形式は受け付けない', () => {
    for (const value of [
      '2025-02-29T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-04-31T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:00.1234Z',
      '2026-01-01T00:00:00+09:00',
      '2026-01-01 00:00:00Z',
    ])
      expect(parseIsoUtcMs(value)).toBeNull();
  });

  test('書式化と解析は往復で一致する', () => {
    for (const ms of [0, -1, 951_827_696_700, 1_790_121_607_123, 4_102_444_799_999]) {
      expect(parseIsoUtcMs(formatIsoUtc(ms))).toBe(ms);
    }
    expect(formatIsoUtc(1_790_121_607_123)).toBe('2026-09-23T00:00:07.123Z');
    expect(formatIsoUtc(1_790_121_607_123, 0)).toBe('2026-09-23T00:00:07Z');
  });

  test('現在時刻はエポックのミリ秒で、書式化して解析し直せる', () => {
    const now = nowMs();
    expect(Math.abs((parseIsoUtcMs(formatIsoUtc(now)) ?? 0) - Math.floor(now))).toBeLessThan(1);
  });

  test('Temporal を持つ Bun では同じ値を返す', () => {
    if (temporal === undefined) return;
    for (let ms = -86_400_000 * 800; ms < 86_400_000 * 40_000; ms += 86_400_000 * 97 + 12_345) {
      const iso = formatIsoUtc(ms);
      expect(parseIsoUtcMs(iso)).toBe(temporal.Instant.from(iso).epochMilliseconds);
    }
  });
});
