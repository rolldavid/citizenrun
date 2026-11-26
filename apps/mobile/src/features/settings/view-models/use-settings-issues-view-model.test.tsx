import type { Issue, Me } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache, writeMeToCache } from '@/features/system';
import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import type { ViewState } from '@/lib/view-state';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply, StubRoute } from '@/test/api-stub';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls, setCanGoBack } from '@/test/router-mock';

import { useSettingsIssuesViewModel } from './use-settings-issues-view-model';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));
vi.mock('expo-splash-screen', () => ({ hideAsync: () => Promise.resolve() }));
// The system feature's index also exports its screens. react-native-safe-area-context 5.11.1 and
// react-native-svg 15.16.0 name their CommonJS builds as `main`, which load the phone files; the module
// builds are the ones that run on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module only the app's bundler provides on the web; no
// hook of these tests draws.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a view-model test loads no asset');
  },
}));

const ISSUES: readonly Issue[] = [
  { id: 'rent-housing', name: 'Rent and housing costs', icon: 'rent-housing', sort: 1 },
  { id: 'climate', name: 'Climate', icon: 'climate', sort: 4 },
  { id: 'schools', name: 'Schools', icon: 'schools', sort: 11 },
  { id: 'transit', name: 'Transit', icon: 'transit', sort: 13 },
];

const ISSUES_ROUTE: StubRoute = {
  method: 'GET',
  path: '/v1/issues',
  reply: json(200, { items: ISSUES, nextCursor: null }),
};

const SAVED_PICKS = [
  { issueId: 'rent-housing', starred: true },
  { issueId: 'climate', starred: false },
  { issueId: 'schools', starred: false },
];

const NEW_PICKS = [
  { issueId: 'schools', starred: true },
  { issueId: 'transit', starred: false },
  { issueId: 'climate', starred: false },
];

const ME = fixtureMe({ issues: SAVED_PICKS });

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
});

function setIssuesRoute(reply: StubReply | ((index: number) => StubReply)): StubRoute {
  return {
    method: 'PUT',
    path: '/v1/me/issues',
    reply: (_request, index) => (typeof reply === 'function' ? reply(index) : reply),
  };
}

function dataOf<D>(view: ViewState<D>): D {
  if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
  return view.data;
}

async function loaded(me: Me = ME) {
  writeMeToCache(queryClient.get(), me);
  const hook = renderHookWithClient(() => useSettingsIssuesViewModel());
  await waitFor(() => {
    expect(hook.result.current.status).toBe('ready');
  });
  return hook;
}

function puts() {
  return stub.requests.filter((request) => request.method === 'PUT');
}

describe('useSettingsIssuesViewModel', () => {
  it('starts from the saved issues', async () => {
    stub.use([ISSUES_ROUTE]);
    const hook = await loaded();

    const data = dataOf(hook.result.current);
    expect(data.initial).toEqual(SAVED_PICKS);
    expect(data.issues.map((issue) => issue.id)).toEqual(ISSUES.map((issue) => issue.id));
    expect(data.submit).toEqual({ status: 'idle', errorCode: null });
  });

  it('saves, then reports saved', async () => {
    const saved = fixtureMe({ issues: NEW_PICKS });
    stub.use([ISSUES_ROUTE, setIssuesRoute(json(200, saved))]);
    const hook = await loaded();

    act(() => {
      dataOf(hook.result.current).onContinue(NEW_PICKS);
    });
    expect(dataOf(hook.result.current).submit.status).toBe('sending');

    await waitFor(() => {
      expect(dataOf(hook.result.current).submit).toEqual({ status: 'saved', errorCode: null });
    });
    expect(puts().map((request) => request.body)).toEqual([
      {
        issues: [
          { issueId: 'climate', starred: false },
          { issueId: 'schools', starred: true },
          { issueId: 'transit', starred: false },
        ],
      },
    ]);
    expect(readMeFromCache(hook.client)?.issues).toEqual(NEW_PICKS);
    expect(routerCalls).toEqual([]);
  });

  it('shows a refused save without saved', async () => {
    stub.use([ISSUES_ROUTE, setIssuesRoute(apiError(429, 'rate_limited'))]);
    const hook = await loaded();

    act(() => {
      dataOf(hook.result.current).onContinue(NEW_PICKS);
    });

    await waitFor(() => {
      expect(dataOf(hook.result.current).submit).toEqual({
        status: 'idle',
        errorCode: 'rate_limited',
      });
    });
    expect(routerCalls).toEqual([]);
  });

  it('goes back to settings', async () => {
    stub.use([ISSUES_ROUTE]);
    const hook = await loaded();

    act(() => {
      dataOf(hook.result.current).onBack();
    });
    expect(routerCalls).toEqual([{ op: 'replace', path: '/settings' }]);

    act(() => {
      setCanGoBack(true);
    });
    act(() => {
      dataOf(hook.result.current).onBack();
    });
    expect(routerCalls).toEqual([
      { op: 'replace', path: '/settings' },
      { op: 'back', path: null },
    ]);
  });

  it('clears saved on the next change', async () => {
    stub.use([
      ISSUES_ROUTE,
      setIssuesRoute((index) =>
        index === 0 ? json(200, fixtureMe({ issues: NEW_PICKS })) : { kind: 'hang' },
      ),
    ]);
    const hook = await loaded();
    act(() => {
      dataOf(hook.result.current).onContinue(NEW_PICKS);
    });
    await waitFor(() => {
      expect(dataOf(hook.result.current).submit.status).toBe('saved');
    });

    act(() => {
      dataOf(hook.result.current).onContinue(SAVED_PICKS);
    });

    expect(dataOf(hook.result.current).submit.status).toBe('sending');
    expect(puts()).toHaveLength(2);
  });
});
