import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock } from '@/test/router-mock';

import { useNow } from './now';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(2027, 2, 5, 23, 59, 0));
});

afterEach(() => {
  vi.useRealTimers();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

describe('useNow', () => {
  it('moves to the new day at local midnight', () => {
    const { result } = renderHookWithClient(() => useNow());
    expect(result.current.getDate()).toBe(5);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.getMonth()).toBe(2);
    expect(result.current.getDate()).toBe(6);
  });

  it('refreshes when the app regains focus', () => {
    const { result } = renderHookWithClient(() => useNow());
    const before = result.current.getTime();
    vi.setSystemTime(before + 3_600_000);
    act(() => {
      queryClientFake.setFocused(true);
    });
    expect(result.current.getTime()).toBe(before + 3_600_000);
  });

  it('stops its timer on unmount', () => {
    const { unmount } = renderHookWithClient(() => useNow());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
