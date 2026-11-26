import { afterEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache } from '@/features/system';
import { getSessionPresence, resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { fixtureMe, fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import { PlatformError } from '@/platform/shared';
import { session } from '@/platform/session';
import { queryClient } from '@/platform/query-client';
import { sessionFake } from '@/test/platform/session';

import { startSession } from './session-start';

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
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

afterEach(() => {
  resetSessionPresence();
});

describe('startSession', () => {
  it('adopts the token, caches Me and marks the session present', async () => {
    const client = queryClient.get();
    const info = fixtureSessionInfo({ me: fixtureMe({ handle: 'fresh_fixture' }) });

    await expect(startSession(info, client)).resolves.toBe('started');

    expect(sessionFake.calls).toEqual([{ op: 'adopt', hasToken: true }]);
    expect(readMeFromCache(client)).toEqual(info.me);
    expect(getSessionPresence()).toBe('present');
  });

  it('changes nothing when the token cannot be stored', async () => {
    vi.spyOn(session, 'adopt').mockRejectedValueOnce(
      new PlatformError('session', 'session.store_failed'),
    );
    setSessionPresence('absent');
    const client = queryClient.get();

    await expect(startSession(fixtureSessionInfo(), client)).resolves.toBe('store_failed');

    expect(readMeFromCache(client)).toBeNull();
    expect(getSessionPresence()).toBe('absent');
  });
});
