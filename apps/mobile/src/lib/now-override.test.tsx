import { renderHook } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NowOverrideContext, useNow } from './now';

const FIXED = new Date('2026-11-15T17:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow and its override', () => {
  it('answers the override', () => {
    vi.setSystemTime(new Date('2027-03-05T12:00:00.000Z'));
    const given = new Date('2026-11-20T09:30:00.000Z');
    function Wrapper({ children }: { children: ReactNode }): JSX.Element {
      return <NowOverrideContext.Provider value={given}>{children}</NowOverrideContext.Provider>;
    }
    const { result } = renderHook(() => useNow(), { wrapper: Wrapper });

    expect(result.current).toBe(given);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers the clock without one', () => {
    vi.setSystemTime(FIXED);
    const { result } = renderHook(() => useNow());

    expect(result.current.toISOString()).toBe(FIXED.toISOString());
    // Without an override the midnight timer runs as before.
    expect(vi.getTimerCount()).toBe(1);
  });
});
