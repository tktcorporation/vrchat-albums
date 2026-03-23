import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQueryQueue } from '../useQueryQueue';

// Mock setTimeout and clearTimeout
vi.useFakeTimers();

describe('useQueryQueue', () => {
  beforeEach(() => {
    vi.clearAllTimers();
  });

  it('should return false initially when not visible', () => {
    const { result } = renderHook(() => useQueryQueue(false, 0, 100));
    expect(result.current).toBe(false);
  });

  it('should enable query after delay when visible', () => {
    const { result } = renderHook(() => useQueryQueue(true, 0, 100));

    expect(result.current).toBe(false);

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(true);
  });

  it('should disable query when visibility changes to false', () => {
    const { result, rerender } = renderHook(
      ({ isVisible }) => useQueryQueue(isVisible, 0, 100),
      { initialProps: { isVisible: true } },
    );

    // Enable query first
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(true);

    // Change visibility to false
    act(() => {
      rerender({ isVisible: false });
    });

    expect(result.current).toBe(false);
  });

  it('should respect priority-based delay', () => {
    const { result: lowPriority } = renderHook(() =>
      useQueryQueue(true, 5, 100),
    );
    const { result: highPriority } = renderHook(() =>
      useQueryQueue(true, 1, 100),
    );

    expect(lowPriority.current).toBe(false);
    expect(highPriority.current).toBe(false);

    // High priority should enable first (100ms + 1*10 = 110ms)
    act(() => {
      vi.advanceTimersByTime(110);
    });

    expect(highPriority.current).toBe(true);
    expect(lowPriority.current).toBe(false);

    // Low priority should enable later (100ms + 5*10 = 150ms)
    act(() => {
      vi.advanceTimersByTime(40); // Total 150ms
    });

    expect(lowPriority.current).toBe(true);
  });

  it('should clear timeout when visibility changes before timeout completes', () => {
    const { result, rerender } = renderHook(
      ({ isVisible }) => useQueryQueue(isVisible, 0, 1000),
      { initialProps: { isVisible: true } },
    );

    expect(result.current).toBe(false);

    // Change visibility to false before timeout completes
    act(() => {
      vi.advanceTimersByTime(500); // Half way through
      rerender({ isVisible: false });
    });

    // Complete the original timeout period
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Should still be false since timeout was cleared
    expect(result.current).toBe(false);
  });

  it('should handle rapid visibility changes', () => {
    const { result, rerender } = renderHook(
      ({ isVisible }) => useQueryQueue(isVisible, 0, 100),
      { initialProps: { isVisible: false } },
    );

    // Start with invisible, then become visible
    act(() => {
      rerender({ isVisible: true });
    });

    // Advance part way through timeout
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Become invisible (should clear timeout)
    act(() => {
      rerender({ isVisible: false });
    });

    // Advance past original timeout
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Should still be false since timeout was cleared
    expect(result.current).toBe(false);

    // Become visible again
    act(() => {
      rerender({ isVisible: true });
    });

    // Complete the new timeout
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(true);
  });

  it('should update priority dynamically', () => {
    const { result, rerender } = renderHook(
      ({ priority }) => useQueryQueue(true, priority, 100),
      { initialProps: { priority: 0 } },
    );

    expect(result.current).toBe(false);

    // Change priority before timeout
    act(() => {
      rerender({ priority: 3 });

      // Original delay (100ms) should still apply for the current timeout
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(true);
  });
});
