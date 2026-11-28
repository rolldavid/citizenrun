import { useQuery } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { peekRememberedNext, rememberNext, resetNavigationState } from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { links } from '@/platform/links';
import { queryClient } from '@/platform/query-client';
import { session } from '@/platform/session';
import { storage } from '@/platform/storage';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubRoute } from '@/test/api-stub';
import { ageAssuranceFake } from '@/test/platform/age-assurance';
import { linksFake } from '@/test/platform/links';
import { queryClientFake } from '@/test/platform/query-client';
import { sessionFake } from '@/test/platform/session';
import { storageFake } from '@/test/platform/storage';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls, setRoute } from '@/test/router-mock';
import { FONT_FACES } from '@/ui/fonts';

import { resetColdStartAgeCheck } from '../data/age-signal';
import { resetSystemState, setThemeChoice } from '../data/system-state';

import { useRootViewModel } from './use-root-view-model';

const constants = vi.hoisted(() => ({ extra: { variant: 'development' } }));
const splash = vi.hoisted(() => ({ hidden: 0 }));

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: constants.extra } } }));
vi.mock('expo-splash-screen', () => ({
  hideAsync: () => {
    splash.hidden += 1;
    return Promise.resolve();
  },
}));

const DELETION = {
  deletionRequestedAt: '2027-01-20T12:00:00.000Z',
  completesBy: '2027-02-19T12:00:00.000Z',
};

let stub: ApiStub;

beforeEach(() => {
  splash.hidden = 0;
  stub = installApiStub([]);
  configureTestApiClient({
    onUnauthorized: () => sessionFake.lastCallbacks()?.onUnauthorized(),
    onUpgradeRequired: () => sessionFake.lastCallbacks()?.onUpgradeRequired(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
  resetSystemState();
  resetColdStartAgeCheck();
  constants.extra.variant = 'development';
});

function meRoute(me = fixtureMe()): StubRoute {
  return { method: 'GET', path: '/v1/me', reply: json(200, me) };
}

function endLocalCalls() {
  return sessionFake.calls.filter((call) => call.op === 'endLocal');
}

function requestsTo(method: string, path: string) {
  return stub.requests.filter((request) => request.method === method && request.path === path);
}

function render() {
  return renderHookWithClient(() => useRootViewModel());
}

async function readyHook() {
  const hook = render();
  await waitFor(() => {
    expect(hook.result.current.boot).toBe('ready');
  });
  return hook;
}

/** Lets pending promise callbacks (the fonts answer, a request) run inside act. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useRootViewModel', () => {
  it('starts the modules in order before the app is ready', async () => {
    const order = [
      vi.spyOn(storage, 'hydrate'),
      vi.spyOn(session, 'configure'),
      vi.spyOn(session, 'hydrate'),
      vi.spyOn(queryClient, 'start'),
    ];
    const { result } = render();
    expect(result.current.boot).toBe('starting');
    await waitFor(() => {
      expect(result.current.boot).toBe('ready');
    });
    const calls = order.map((spy) => {
      expect(spy).toHaveBeenCalledTimes(1);
      return spy.mock.invocationCallOrder[0] ?? 0;
    });
    expect(calls).toEqual([...calls].sort((a, b) => a - b));
    expect(sessionFake.lastCallbacks()).not.toBeNull();
  });

  it('boot follows the platform start', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(storage, 'hydrate').mockImplementation(() => gate);

    const { result } = render();
    await settle();
    expect(result.current.boot).toBe('starting');
    expect(result.current.themeChoice).toBe('system');
    expect(splash.hidden).toBe(0);

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => {
      expect(result.current.boot).toBe('ready');
    });
    expect(splash.hidden).toBe(1);
  });

  it('reads the theme from storage', async () => {
    storageFake.seed({ theme: 'light' });
    const { result } = await readyHook();
    expect(result.current.themeChoice).toBe('light');
  });

  it('follows the system theme when none is stored', async () => {
    const { result } = await readyHook();
    expect(result.current.themeChoice).toBe('system');
  });

  it('follows the appearance choice', async () => {
    const { result } = await readyHook();
    act(() => {
      setThemeChoice('dark');
    });
    expect(result.current.themeChoice).toBe('dark');
  });

  it('takes the fonts-ready answer', async () => {
    const fontsReady = vi.spyOn(links, 'fontsReady');
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.fontsReady).toBe(true);
    });
    expect(fontsReady).toHaveBeenCalledTimes(1);
    expect(fontsReady.mock.calls[0]?.[0]).toBe(FONT_FACES);
  });

  it('keeps fonts not ready on a false answer', async () => {
    linksFake.scriptFontsReady(false);
    const fontsReady = vi.spyOn(links, 'fontsReady');
    const { result } = await readyHook();
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(1);
    expect(result.current.fontsReady).toBe(false);
  });

  it('asks again for the fonts when the network comes back', async () => {
    linksFake.scriptFontsReady(false);
    const fontsReady = vi.spyOn(links, 'fontsReady');
    const { result } = await readyHook();
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(1);

    act(() => {
      queryClientFake.setOnline(false);
    });
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(1);

    act(() => {
      queryClientFake.setOnline(true);
    });
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(2);
    expect(result.current.fontsReady).toBe(false);

    linksFake.scriptFontsReady(true);
    act(() => {
      queryClientFake.setOnline(false);
    });
    act(() => {
      queryClientFake.setOnline(true);
    });
    await waitFor(() => {
      expect(result.current.fontsReady).toBe(true);
    });
    expect(fontsReady).toHaveBeenCalledTimes(3);

    // A true answer ends the subscription.
    act(() => {
      queryClientFake.setOnline(false);
    });
    act(() => {
      queryClientFake.setOnline(true);
    });
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(3);
  });

  it('shows the update screen when an upgrade is blocked', async () => {
    const { result } = await readyHook();
    expect(result.current.system).toBeNull();
    expect(result.current.shell.mode).toBe('app');

    linksFake.scriptReloadOnce('upgrade_required', [false]);
    const callbacks = sessionFake.lastCallbacks();
    expect(callbacks).not.toBeNull();
    act(() => {
      callbacks?.onUpgradeRequired();
    });
    expect(result.current.system).toBe('update');
    expect(result.current.shell.mode).toBe('bare');
    expect(result.current.shell.active).toBeNull();
  });

  it('gives the shell the route and the signed-out values', async () => {
    const { result } = await readyHook();
    expect(result.current.shell).toEqual({
      mode: 'app',
      active: 'home',
      unread: { messages: 0, activity: 0 },
      place: null,
      signedIn: false,
      showGetAppBar: false,
      suspended: null,
    });
    expect(result.current.createDialogOpen).toBe(false);
    act(() => {
      setRoute('/no-such-page');
    });
    expect(result.current.shell.mode).toBe('bare');
    expect(result.current.shell.active).toBeNull();
  });

  it('stays signed out without asking for Me when the phone has no session', async () => {
    sessionFake.scriptPresence('absent');
    const { result } = await readyHook();
    await settle();
    expect(requestsTo('GET', '/v1/me')).toEqual([]);
    expect(result.current.shell.signedIn).toBe(false);
    expect(getSessionPresence()).toBe('absent');
  });

  it('loads Me for a stored session', async () => {
    sessionFake.scriptPresence('present');
    stub.use([meRoute()]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.shell.signedIn).toBe(true);
    });
    expect(getSessionPresence()).toBe('present');
    expect(requestsTo('GET', '/v1/me')).toHaveLength(1);
  });

  it('marks the session present once Me loads on the web', async () => {
    sessionFake.scriptPresence('unknown');
    stub.use([meRoute()]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.shell.signedIn).toBe(true);
    });
    expect(getSessionPresence()).toBe('present');
  });

  it('treats a 401 from Me as a logout and opens sign-in from a session route', async () => {
    sessionFake.scriptPresence('unknown');
    setRoute('/settings/export');
    stub.use([{ method: 'GET', path: '/v1/me', reply: apiError(401, 'unauthenticated') }]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/sign-in?next=%2Fsettings%2Fexport' }]);
    });
    // On the web no session was seen in this page load, so nothing on the device is ended.
    expect(endLocalCalls()).toEqual([]);
    expect(getSessionPresence()).toBe('absent');
    expect(result.current.shell.signedIn).toBe(false);
    // Absent stops the query: the 401 is not asked again.
    await settle();
    expect(requestsTo('GET', '/v1/me')).toHaveLength(1);
  });

  it('ends a stored session the server refuses and opens sign-in from a session route', async () => {
    sessionFake.scriptPresence('present');
    setRoute('/settings/export');
    stub.use([{ method: 'GET', path: '/v1/me', reply: apiError(401, 'unauthenticated') }]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/sign-in?next=%2Fsettings%2Fexport' }]);
    });
    expect(endLocalCalls()).toEqual([{ op: 'endLocal', reason: 'unauthorized' }]);
    expect(getSessionPresence()).toBe('absent');
    expect(result.current.shell.signedIn).toBe(false);
  });

  it("leaves a web visitor's public queries running when Me answers 401", async () => {
    sessionFake.scriptPresence('unknown');
    // The web file empties the cache, which drops the queries in flight.
    const endLocal = vi.spyOn(session, 'endLocal').mockImplementation(() => {
      queryClient.clear();
      return Promise.resolve();
    });
    let answer: (value: string) => void = () => undefined;
    const answered = new Promise<string>((resolve) => {
      answer = resolve;
    });
    // A public screen's query, in a tree of its own, so the root's renders do not touch it.
    const publicQuery = renderHookWithClient(() =>
      useQuery({ queryKey: ['public-probe'], queryFn: () => answered }, queryClient.get()),
    );
    expect(publicQuery.result.current.status).toBe('pending');
    stub.use([{ method: 'GET', path: '/v1/me', reply: apiError(401, 'unauthenticated') }]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(getSessionPresence()).toBe('absent');
    });
    await settle();
    expect(endLocal).not.toHaveBeenCalled();
    expect(routerCalls).toEqual([]);
    expect(result.current.shell.signedIn).toBe(false);

    await act(async () => {
      answer('ready');
      await answered;
    });
    await waitFor(() => {
      expect(publicQuery.result.current.data).toBe('ready');
    });
  });

  it('signs the shell out at once when a session ends on a public route', async () => {
    sessionFake.scriptPresence('present');
    stub.use([meRoute()]);
    // The phone file deletes the token before it empties the cache.
    let release: () => void = () => undefined;
    const tokenDeleted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const endLocal = vi.spyOn(session, 'endLocal').mockImplementation(async () => {
      await tokenDeleted;
      queryClient.clear();
    });
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.shell.signedIn).toBe(true);
    });

    await act(async () => {
      sessionFake.lastCallbacks()?.onUnauthorized();
      await Promise.resolve();
    });
    expect(endLocal).toHaveBeenCalledWith('unauthorized');
    expect(result.current.shell.signedIn).toBe(false);

    await act(async () => {
      release();
      await tokenDeleted;
    });
    await settle();
    expect(getSessionPresence()).toBe('absent');
    expect(result.current.shell.signedIn).toBe(false);
    expect(routerCalls).toEqual([]);
  });

  it('shows the agreements sheet when a document changed', async () => {
    const me = fixtureMe();
    sessionFake.scriptPresence('present');
    stub.use([meRoute(fixtureMe({ consents: { ...me.consents, needed: ['terms'] } }))]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.system).toBe('agreements');
    });
    expect(result.current.shell.mode).toBe('app');

    act(() => {
      setRoute('/settings/export');
    });
    expect(result.current.system).toBeNull();
  });

  it('reports a minor signal at a cold start', async () => {
    sessionFake.scriptPresence('present');
    ageAssuranceFake.scriptSignal({ kind: 'minor', tier: 'declared', under13: false });
    stub.use([meRoute(), { method: 'POST', path: '/v1/me/age', reply: json(202, DELETION) }]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.system).toBe('adultsOnly');
    });
    expect(requestsTo('POST', '/v1/me/age')).toHaveLength(1);
    expect(requestsTo('POST', '/v1/me/age')[0]?.body).toStrictEqual({
      result: 'under_18',
      sourceTier: 'declared',
    });
    expect(sessionFake.calls).toContainEqual({ op: 'endLocal', reason: 'account_minor' });
    expect(result.current.shell.mode).toBe('bare');
  });

  it('does not ask the store where it cannot answer', async () => {
    ageAssuranceFake.setStoreSignalSupported(false);
    sessionFake.scriptPresence('present');
    stub.use([meRoute()]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.shell.signedIn).toBe(true);
    });
    await settle();
    expect(ageAssuranceFake.calls.filter((call) => call.op === 'requestStoreSignal')).toEqual([]);
    expect(requestsTo('POST', '/v1/me/age')).toEqual([]);
  });

  it("leads the shell's items to their targets", async () => {
    sessionFake.scriptPresence('present');
    stub.use([meRoute()]);
    const signedIn = await readyHook();
    await waitFor(() => {
      expect(signedIn.result.current.shell.signedIn).toBe(true);
    });
    act(() => {
      signedIn.result.current.onNavigate('profile');
    });
    act(() => {
      signedIn.result.current.onNavigate('explore');
    });
    expect(routerCalls).toEqual([
      { op: 'push', path: '/settings' },
      { op: 'push', path: '/explore' },
    ]);
    signedIn.unmount();

    resetRouterMock();
    resetSystemState();
    resetSessionPresence();
    queryClientFake.reset();
    sessionFake.scriptPresence('absent');
    const signedOut = await readyHook();
    act(() => {
      signedOut.result.current.onNavigate('profile');
    });
    expect(routerCalls).toEqual([{ op: 'push', path: '/sign-in?next=%2Fsettings' }]);
  });

  it("dismisses to the item's root when it is chosen again", async () => {
    const { result } = await readyHook();
    act(() => {
      result.current.onReselect('home');
    });
    expect(routerCalls).toEqual([{ op: 'dismissTo', path: '/' }]);
  });

  it('forgets the remembered next once the person lands', async () => {
    rememberNext('/settings');
    sessionFake.scriptPresence('present');
    stub.use([meRoute()]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.shell.signedIn).toBe(true);
    });
    await waitFor(() => {
      expect(peekRememberedNext()).toBeNull();
    });
  });

  it('keeps the remembered next on a sign-in route', async () => {
    rememberNext('/settings');
    sessionFake.scriptPresence('present');
    setRoute('/sign-in');
    stub.use([meRoute()]);
    const { result } = await readyHook();
    await waitFor(() => {
      expect(result.current.shell.signedIn).toBe(true);
    });
    await settle();
    expect(peekRememberedNext()).toBe('/settings');
  });

  it('redirects nothing by itself', async () => {
    sessionFake.scriptPresence('absent');
    await readyHook();
    await settle();
    expect(routerCalls).toEqual([]);
  });
});
