import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStalled } from '../useStalled';

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('useStalled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('値がしきい値の間変わらなければ止まっているとみなす', () => {
    const { result } = renderHook(() =>
      useStalled(50, { thresholdMs: 1500, active: true }),
    );
    advance(1499);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it('値が動いたらすぐに解除し、新しい値でしきい値を数え直す', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useStalled(value, { thresholdMs: 1500, active: true }),
      { initialProps: { value: 50 } },
    );
    advance(1500);
    expect(result.current).toBe(true);

    rerender({ value: 60 });
    expect(result.current).toBe(false);
    advance(1000);
    expect(result.current).toBe(false);
    advance(500);
    expect(result.current).toBe(true);
  });

  it('active が false になったら解除し、その後は時間が経っても止まっているとみなさない', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useStalled(95, { thresholdMs: 1500, active }),
      { initialProps: { active: true } },
    );
    advance(1500);
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
    advance(5000);
    expect(result.current).toBe(false);
  });

  it('しきい値に届く前に active が false になったらタイマーを捨てる', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useStalled(30, { thresholdMs: 1500, active }),
      { initialProps: { active: true } },
    );
    advance(1000);
    rerender({ active: false });
    advance(5000);
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
