import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleUnauthorized, readMeFromCache, writeMeToCache } from '@/features/system';
import { peekRememberedNext, rememberNext, resetNavigationState } from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { configureTestApiClient, installApiStub } from '@/test/api-stub';
import type { ApiStub, StubReply } from '@/test/api-stub';
import { authFake } from '@/test/platform/auth';
import { queryClientFake } from '@/test/platform/query-client';
import { sessionFake } from '@/test/platform/session';
import { storageFake } from '@/test/platform/storage';

import { logout } from './logout';

// The session module's real web file, so the session end is the one the web build runs (CTL-11).
vi.mock('@/platform/session', () => vi.importActual('@/platform/session/index.web'));
// The system feature's index loads its screens: the web builds of these two libraries, as its own tests use.
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing of the app loads no asset');
  },
}));
vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0', extra: { variant: 'development' } } },
}));

let stub: ApiStub;

function answerLogout(reply: StubReply): void {
  stub.use([{ method: 'POST', path: '/v1/auth/logout', reply }]);
}

/** A signed-in device: a session, a cached Me, a remembered next and a draft-like stored key. */
function signedIn(): void {
  setSessionPresence('present');
  writeMeToCache(queryClient.get(), fixtureMe());
  rememberNext('/settings');
  storageFake.seed({ theme: 'dark' });
}

function expectEverythingCleared(): void {
  expect(queryClientFake.calls).toContainEqual({ op: 'clear' });
  expect(storageFake.calls).toContainEqual({ op: 'clearUserData' });
  expect(authFake.calls).toContainEqual({ op: 'clearProviderState' });
  expect(readMeFromCache(queryClient.get())).toBeNull();
  expect(getSessionPresence()).toBe('absent');
  expect(peekRememberedNext()).toBeNull();
  // The real web file ran, not the session fake.
  expect(sessionFake.calls).toEqual([]);
}

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNavigationState();
  resetSessionPresence();
});

describe('logout', () => {
  it('logout clears token, cache, drafts and remembered details', async () => {
    answerLogout({ kind: 'empty', status: 204 });
    signedIn();

    await logout();

    expect(stub.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['POST', '/v1/auth/logout', {}],
    ]);
    expectEverythingCleared();
  });

  it('logout clears drafts, query cache and remembered details', async () => {
    answerLogout({ kind: 'network_error' });
    signedIn();

    await logout();

    expect(stub.requests).toHaveLength(1);
    expectEverythingCleared();
  });

  it('a 401 clears the same', async () => {
    signedIn();

    await handleUnauthorized();

    expect(stub.requests).toEqual([]);
    expectEverythingCleared();
  });
});
