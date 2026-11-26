import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock } from '@/test/router-mock';

import { meQueryKey, readMeFromCache, useMe, writeConsentsToCache, writeMeToCache } from './me';
import { resetSystemState, setBoot } from './system-state';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([{ method: 'GET', path: '/v1/me', reply: json(200, fixtureMe()) }]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
  resetSystemState();
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useMe', () => {
  it('loads Me once the app is ready and a session may exist', async () => {
    const { result } = renderHookWithClient(() => useMe());
    await settle();
    // Nothing is asked while the platform starts.
    expect(stub.requests).toEqual([]);
    expect(result.current.me).toBeNull();

    act(() => {
      setBoot('ready');
    });
    await waitFor(() => {
      expect(result.current.me?.handle).toBe('test_fixture');
    });
    expect(stub.requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/v1/me'],
    ]);
    expect(result.current.source.status).toBe('success');
  });

  it('does not ask without a session', async () => {
    setBoot('ready');
    setSessionPresence('absent');
    const { result } = renderHookWithClient(() => useMe());
    await settle();
    expect(stub.requests).toEqual([]);
    expect(result.current.me).toBeNull();
  });

  it('answers no Me once the session is absent, while the last one is still cached', async () => {
    setBoot('ready');
    setSessionPresence('present');
    writeMeToCache(queryClient.get(), fixtureMe());
    const { result } = renderHookWithClient(() => useMe());
    expect(result.current.me?.handle).toBe('test_fixture');
    act(() => {
      setSessionPresence('absent');
    });
    expect(readMeFromCache(queryClient.get())).not.toBeNull();
    expect(result.current.me).toBeNull();
    await settle();
  });
});

describe('the Me cache', () => {
  it('writes Me and merges consents into the cache', () => {
    const client = queryClient.get();
    const me = fixtureMe();
    const consents = {
      ...me.consents,
      aiScreening: 'declined' as const,
      needed: ['terms' as const],
    };

    // With no cached Me the cache stays empty.
    writeConsentsToCache(client, consents);
    expect(client.getQueryData(meQueryKey())).toBeUndefined();
    expect(readMeFromCache(client)).toBeNull();

    writeMeToCache(client, me);
    expect(readMeFromCache(client)).toEqual(me);

    writeConsentsToCache(client, consents);
    expect(readMeFromCache(client)).toEqual({ ...me, consents });
  });
});
