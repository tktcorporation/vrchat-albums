import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCountUp } from '../useCountUp';

// requestAnimationFrame も偽のタイマーで進め、1 フレームずつ表示値を観察する
const FRAME_MS = 16;

const advanceFrames = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初回の描画では目標値をそのまま出す', () => {
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
  });

  it('目標値が増えたら、減らずに数え上げて目標値で止まる', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target, { durationMs: 600 }),
      { initialProps: { target: 50 } },
    );

    rerender({ target: 95 });
    // 数え上げが始まる前は前の値のまま（目標値へ一気に飛ばない）
    expect(result.current).toBe(50);

    const seen: number[] = [result.current];
    for (let elapsed = 0; elapsed < 800; elapsed += FRAME_MS) {
      advanceFrames(FRAME_MS);
      seen.push(result.current);
    }

    expect(seen.at(-1)).toBe(95);
    // 途中の値を経由し、どこでも前の値より小さくならず、目標値を超えない
    expect(seen.some((v) => v > 50 && v < 95)).toBe(true);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[i]).toBeLessThanOrEqual(95);
    }
  });

  it('数え上げの途中で目標値が増えたら、その時点の値から数え直す', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target, { durationMs: 600 }),
      { initialProps: { target: 0 } },
    );

    rerender({ target: 50 });
    advanceFrames(200);
    const midway = result.current;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(50);

    rerender({ target: 100 });
    expect(result.current).toBe(midway);
    advanceFrames(FRAME_MS);
    expect(result.current).toBeGreaterThanOrEqual(midway);

    advanceFrames(800);
    expect(result.current).toBe(100);
  });

  it('目標値が減ったら逆向きに数えず、その値に揃える', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target, { durationMs: 600 }),
      { initialProps: { target: 80 } },
    );

    rerender({ target: 5 });
    expect(result.current).toBe(5);
    advanceFrames(800);
    expect(result.current).toBe(5);

    // 揃えた値から次の増加を数え上げる
    rerender({ target: 20 });
    advanceFrames(FRAME_MS);
    expect(result.current).toBeGreaterThanOrEqual(5);
    expect(result.current).toBeLessThan(20);
    advanceFrames(800);
    expect(result.current).toBe(20);
  });

  it('disabled のときは数え上げずに目標値を即座に出す', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target, { disabled: true }),
      { initialProps: { target: 50 } },
    );

    rerender({ target: 85 });
    expect(result.current).toBe(85);
    rerender({ target: 100 });
    expect(result.current).toBe(100);
  });
});
