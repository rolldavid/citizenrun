import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls, setNavigatorReady, setRoute } from '@/test/router-mock';

import { resetSystemState, setBoot, setMinorEnded } from '../data/system-state';

import { useNavigationGuard } from './use-navigation-guard';

const constants = vi.hoisted(() => ({ extra: { variant: 'development' } }));

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: constants.extra } } }));

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
  resetSystemState();
  constants.extra.variant = 'development';
});

/** A signed-in person whose Me the stub answers. */
function signedIn(me = fixtureMe()): void {
  stub.use([{ method: 'GET', path: '/v1/me', reply: json(200, me) }]);
  setSessionPresence('present');
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useNavigationGuard', () => {
  it('does nothing before the app and the navigator are ready', async () => {
    setSessionPresence('absent');
    setNavigatorReady(false);
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await settle();
    expect(routerCalls).toEqual([]);

    act(() => {
      setBoot('ready');
    });
    await settle();
    expect(routerCalls).toEqual([]);

    act(() => {
      setNavigatorReady(true);
    });
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/welcome' }]);
    });
  });

  it('sends a visitor with no session from / to the welcome screen', async () => {
    setBoot('ready');
    setSessionPresence('absent');
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/welcome' }]);
    });
  });

  it('sends a person mid-onboarding to their step', async () => {
    setBoot('ready');
    signedIn(fixtureMe({ onboardingStep: 'handle' }));
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/onboarding/handle' }]);
    });
  });

  it('follows next after sign-in', async () => {
    setBoot('ready');
    signedIn();
    setRoute('/sign-in', { next: '/settings/export' });
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/settings/export' }]);
    });
  });

  it('does not replace when already there', async () => {
    setBoot('ready');
    setSessionPresence('absent');
    const { rerender } = renderHookWithClient(() => {
      useNavigationGuard();
    });
    await waitFor(() => {
      expect(routerCalls).toHaveLength(1);
    });
    rerender();
    await settle();
    rerender();
    await settle();
    expect(routerCalls).toEqual([{ op: 'replace', path: '/welcome' }]);
  });

  it('waits while a session may exist and Me has not loaded', async () => {
    setBoot('ready');
    stub.use([{ method: 'GET', path: '/v1/me', reply: { kind: 'hang' } }]);
    setRoute('/settings');
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await settle();
    expect(stub.requests).toHaveLength(1);
    expect(routerCalls).toEqual([]);
  });

  it('does not redirect while a system screen replaces the navigator', async () => {
    setBoot('ready');
    setSessionPresence('absent');
    setMinorEnded(true);
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await settle();
    expect(routerCalls).toEqual([]);
  });

  it('lets a development route through for a person mid-onboarding', async () => {
    setBoot('ready');
    signedIn(fixtureMe({ onboardingStep: 'handle' }));
    setRoute('/dev/gallery');
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await waitFor(() => {
      expect(stub.requests).toHaveLength(1);
    });
    await settle();
    expect(routerCalls).toEqual([]);
  });

  it('sends a development route to / in a production build', async () => {
    constants.extra.variant = 'production';
    setBoot('ready');
    setSessionPresence('absent');
    setRoute('/dev/gallery');
    renderHookWithClient(() => {
      useNavigationGuard();
    });
    await waitFor(() => {
      expect(routerCalls[0]).toEqual({ op: 'replace', path: '/' });
    });
    // From `/` the visitor goes on to the welcome screen, by the guard's next row.
    expect(routerCalls.filter((call) => call.path === '/')).toHaveLength(1);
  });
});
