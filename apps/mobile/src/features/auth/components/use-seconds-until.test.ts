// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSecondsUntil } from './use-seconds-until';

const NOW = Date.parse('2027-01-15T12:00:00.000Z');

/** An instant `seconds` after the test's clock. */
function after(seconds: number): string {
  return new Date(NOW + seconds * 1000).toISOString();
}

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSecondsUntil', () => {
  it('counts down and stops at zero', () => {
    const { result } = renderHook(() => useSecondsUntil(after(3)));
    expect(result.current).toBe(3);
    expect(vi.getTimerCount()).toBe(1);
    tick(1000);
    expect(result.current).toBe(2);
    tick(1000);
    expect(result.current).toBe(1);
    tick(1000);
    expect(result.current).toBe(0);
    // Nothing is left to count, so nothing keeps ticking.
    expect(vi.getTimerCount()).toBe(0);
    tick(5000);
    expect(result.current).toBe(0);
  });

  it('rounds a part of a second up, so the count reaches zero only when the instant has come', () => {
    const { result } = renderHook(() => useSecondsUntil(after(1.5)));
    expect(result.current).toBe(2);
    tick(1000);
    expect(result.current).toBe(1);
    tick(1000);
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is zero, with no timer, for an instant that has passed or cannot be read', () => {
    for (const instant of [after(0), after(-30), 'not a time']) {
      const { result, unmount } = renderHook(() => useSecondsUntil(instant));
      expect(result.current, instant).toBe(0);
      expect(vi.getTimerCount(), instant).toBe(0);
      unmount();
    }
  });

  it('starts a new count for a new instant', () => {
    const { result, rerender } = renderHook(({ instant }) => useSecondsUntil(instant), {
      initialProps: { instant: after(2) },
    });
    tick(2000);
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // Half a minute later a new code is sent, and it may be sent again 30 seconds after that.
    vi.setSystemTime(NOW + 32_000);
    rerender({ instant: after(62) });
    expect(result.current).toBe(30);
    expect(vi.getTimerCount()).toBe(1);
    tick(1000);
    expect(result.current).toBe(29);
  });

  it('stops its timer on unmount', () => {
    const { unmount } = renderHook(() => useSecondsUntil(after(30)));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
