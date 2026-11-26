import type { Me } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache, writeMeToCache } from '@/features/system';
import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply, StubRoute } from '@/test/api-stub';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { FIXTURE_ISSUES } from './__fixtures__/issues';
import type { OnboardingIssuesData, OnboardingIssuesViewModel } from './issues.types';
import { useOnboardingIssuesViewModel } from './use-onboarding-issues-view-model';

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

const ISSUES: StubRoute = {
  method: 'GET',
  path: '/v1/issues',
  reply: json(200, { items: [...FIXTURE_ISSUES].reverse(), nextCursor: null }),
};

const AT_ISSUES = fixtureMe({ onboardingStep: 'issues', onboardedAt: null });

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

function mount(me: Me) {
  writeMeToCache(queryClient.get(), me);
  return renderHookWithClient(() => useOnboardingIssuesViewModel());
}

function dataOf(view: OnboardingIssuesViewModel): OnboardingIssuesData {
  if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
  return view.data;
}

async function loaded(me: Me) {
  const hook = mount(me);
  await waitFor(() => {
    expect(hook.result.current.status).toBe('ready');
  });
  return hook;
}

function gets() {
  return stub.requests.filter((request) => request.method === 'GET');
}

function puts() {
  return stub.requests.filter((request) => request.method === 'PUT');
}

const THREE = [
  { issueId: 'schools', starred: true },
  { issueId: 'rent-housing', starred: false },
  { issueId: 'transit', starred: false },
];

describe('useOnboardingIssuesViewModel', () => {
  it('loads the issues and the saved picks', async () => {
    const saved = [
      { issueId: 'rent-housing', starred: true },
      { issueId: 'climate', starred: false },
      { issueId: 'schools', starred: false },
    ];
    stub.use([ISSUES]);
    const hook = mount(fixtureMe({ onboardingStep: 'issues', issues: saved }));
    expect(hook.result.current.status).toBe('loading');

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready');
    });
    const data = dataOf(hook.result.current);
    expect(data.issues).toHaveLength(19);
    expect(data.issues.map((issue) => issue.id)).toEqual(FIXTURE_ISSUES.map((issue) => issue.id));
    expect(data.initial).toEqual(saved);
    expect(data.limits).toEqual({ min: 3, max: 10, maxStarred: 3 });
    expect(data.submit).toEqual({ status: 'idle', errorCode: null });
  });

  it('shows the offline state without cached issues', () => {
    stub.use([ISSUES]);
    queryClientFake.setOnline(false);
    const hook = mount(AT_ISSUES);

    expect(hook.result.current.status).toBe('offline');
    expect(gets()).toEqual([]);
  });

  it('shows the error state when the issues cannot be loaded', async () => {
    stub.use([{ method: 'GET', path: '/v1/issues', reply: apiError(503, 'unavailable') }]);
    const hook = mount(AT_ISSUES);

    await waitFor(() => {
      expect(hook.result.current).toMatchObject({ status: 'error', code: 'unavailable' });
    });
  });

  it('continues with three picks and one star', async () => {
    const saved = fixtureMe({ onboardingStep: 'location', issues: THREE, onboardedAt: null });
    stub.use([ISSUES, setIssuesRoute(json(200, saved))]);
    const hook = await loaded(AT_ISSUES);

    act(() => {
      dataOf(hook.result.current).onContinue(THREE);
    });
    expect(dataOf(hook.result.current).submit.status).toBe('sending');

    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/location' }]);
    });
    expect(puts().map((request) => request.body)).toEqual([
      {
        issues: [
          { issueId: 'rent-housing', starred: false },
          { issueId: 'schools', starred: true },
          { issueId: 'transit', starred: false },
        ],
      },
    ]);
    expect(readMeFromCache(hook.client)?.onboardingStep).toBe('location');
    expect(dataOf(hook.result.current).submit).toEqual({ status: 'idle', errorCode: null });
  });

  it('refetches the issues after an unknown issue', async () => {
    stub.use([ISSUES, setIssuesRoute(apiError(422, 'unknown_issue'))]);
    const hook = await loaded(AT_ISSUES);
    expect(gets()).toHaveLength(1);

    act(() => {
      dataOf(hook.result.current).onContinue(THREE);
    });

    await waitFor(() => {
      expect(gets()).toHaveLength(2);
    });
    expect(dataOf(hook.result.current).submit).toEqual({
      status: 'idle',
      errorCode: 'unknown_issue',
    });
    expect(routerCalls).toEqual([]);
  });

  it('shows any other refusal without refetching', async () => {
    stub.use([ISSUES, setIssuesRoute(apiError(429, 'rate_limited'))]);
    const hook = await loaded(AT_ISSUES);

    act(() => {
      dataOf(hook.result.current).onContinue(THREE);
    });

    await waitFor(() => {
      expect(dataOf(hook.result.current).submit.errorCode).toBe('rate_limited');
    });
    expect(gets()).toHaveLength(1);
  });

  it('sends nothing for two picks', async () => {
    stub.use([ISSUES, setIssuesRoute(json(200, AT_ISSUES))]);
    const hook = await loaded(AT_ISSUES);

    await act(async () => {
      dataOf(hook.result.current).onContinue(THREE.slice(0, 2));
      await Promise.resolve();
    });

    expect(puts()).toEqual([]);
    expect(dataOf(hook.result.current).submit.status).toBe('idle');
  });

  it('sends nothing while offline', async () => {
    stub.use([ISSUES, setIssuesRoute(json(200, AT_ISSUES))]);
    const hook = await loaded(AT_ISSUES);
    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(hook.result.current).toMatchObject({ status: 'ready', stale: true });

    await act(async () => {
      dataOf(hook.result.current).onContinue(THREE);
      await Promise.resolve();
    });

    expect(puts()).toEqual([]);
  });

  it('goes back to the handle step', async () => {
    stub.use([ISSUES]);
    const hook = await loaded(AT_ISSUES);
    act(() => {
      dataOf(hook.result.current).onBack();
    });
    expect(routerCalls).toEqual([{ op: 'replace', path: '/onboarding/handle' }]);
  });
});
