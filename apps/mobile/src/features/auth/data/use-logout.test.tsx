import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { configureTestApiClient, installApiStub } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { sessionFake } from '@/test/platform/session';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { useLogout } from './logout';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([
    { method: 'POST', path: '/v1/auth/logout', reply: { kind: 'empty', status: 204 } },
  ]);
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

describe('useLogout', () => {
  it('reports sending, then goes to /', async () => {
    const hook = renderHook(() => useLogout());
    expect(hook.result.current.status).toBe('idle');

    act(() => {
      hook.result.current.run();
    });
    expect(hook.result.current.status).toBe('sending');
    expect(routerCalls).toEqual([]);

    await waitFor(() => {
      expect(hook.result.current.status).toBe('idle');
    });
    expect(routerCalls).toEqual([{ op: 'replace', path: '/' }]);
    expect(sessionFake.calls).toContainEqual({ op: 'endLocal', reason: 'logout' });
  });

  it('ignores a second press while sending', async () => {
    const hook = renderHook(() => useLogout());

    act(() => {
      hook.result.current.run();
      hook.result.current.run();
    });
    act(() => {
      hook.result.current.run();
    });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('idle');
    });

    expect(stub.requests).toHaveLength(1);
    expect(routerCalls).toEqual([{ op: 'replace', path: '/' }]);
  });
});
