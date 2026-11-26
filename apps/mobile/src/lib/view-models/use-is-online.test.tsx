import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock } from '@/test/router-mock';

import { useIsOnline } from './query';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));

afterEach(() => {
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

describe('useIsOnline', () => {
  it('follows the connection', () => {
    const { result } = renderHookWithClient(() => useIsOnline());
    expect(result.current).toBe(true);
    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(result.current).toBe(false);
    act(() => {
      queryClientFake.setOnline(true);
    });
    expect(result.current).toBe(true);
  });
});
