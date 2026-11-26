import type { Me } from '@citizenrun/shared';
import { act } from '@testing-library/react';
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

import { useOnboardingHandleViewModel } from './use-onboarding-handle-view-model';

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

const FREE_CHECK: StubRoute = {
  method: 'GET',
  path: '/v1/handles/check',
  reply: (request) =>
    json(200, { handle: request.query['handle'] ?? '', available: true, reason: null }),
};

let stub: ApiStub;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  stub = installApiStub([]);
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetRouterMock();
  resetNavigationState();
});

function setHandleRoute(reply: StubReply): StubRoute {
  return { method: 'PUT', path: '/v1/me/handle', reply };
}

function puts() {
  return stub.requests.filter((request) => request.method === 'PUT');
}

/** Moves the fake clock and lets the answers that follow it arrive. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    for (let round = 0; round < 10; round += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
  });
}

function mount(me: Me) {
  writeMeToCache(queryClient.get(), me);
  return renderHookWithClient(() => useOnboardingHandleViewModel());
}

async function typed(hook: ReturnType<typeof mount>, value: string): Promise<void> {
  act(() => {
    hook.result.current.onChange(value);
  });
  await settle(300);
}

async function pressContinue(hook: ReturnType<typeof mount>): Promise<void> {
  act(() => {
    hook.result.current.onContinue();
  });
  await settle();
}

const NEW_PERSON = fixtureMe({ handle: null, onboardingStep: 'handle', onboardedAt: null });

describe('useOnboardingHandleViewModel', () => {
  it('continues with a free handle', async () => {
    const saved = fixtureMe({ handle: 'test_new', onboardingStep: 'issues', onboardedAt: null });
    stub.use([FREE_CHECK, setHandleRoute(json(200, saved))]);
    const hook = mount(NEW_PERSON);
    expect(hook.result.current.initialHandle).toBeNull();

    await typed(hook, 'test_new');
    expect(hook.result.current.check).toBe('free');
    act(() => {
      hook.result.current.onContinue();
    });
    expect(hook.result.current.submit.status).toBe('sending');
    await settle();

    expect(puts().map((request) => request.body)).toEqual([{ handle: 'test_new' }]);
    expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/issues' }]);
    expect(readMeFromCache(hook.client)?.handle).toBe('test_new');
    expect(hook.result.current.submit).toEqual({
      status: 'idle',
      errorCode: null,
      changeAvailableAt: null,
    });
  });

  it('continues after a failed check and lets the server decide', async () => {
    const saved = fixtureMe({ handle: 'test_new', onboardingStep: 'issues', onboardedAt: null });
    stub.use([
      { method: 'GET', path: '/v1/handles/check', reply: apiError(429, 'rate_limited') },
      setHandleRoute(json(200, saved)),
    ]);
    const hook = mount(NEW_PERSON);

    await typed(hook, 'test_new');
    expect(hook.result.current.check).toBe('failed');
    await pressContinue(hook);

    expect(puts().map((request) => request.body)).toEqual([{ handle: 'test_new' }]);
    expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/issues' }]);
  });

  it('sends nothing while the check is still running or refused', async () => {
    stub.use([FREE_CHECK, setHandleRoute(json(200, NEW_PERSON))]);
    const hook = mount(NEW_PERSON);

    act(() => {
      hook.result.current.onChange('test_new');
    });
    await pressContinue(hook);
    await typed(hook, 'ab');
    await pressContinue(hook);

    expect(puts()).toEqual([]);
  });

  it('returns the field to taken when someone else took it first', async () => {
    stub.use([FREE_CHECK, setHandleRoute(apiError(409, 'handle_taken'))]);
    const hook = mount(NEW_PERSON);

    await typed(hook, 'test_new');
    await pressContinue(hook);

    expect(hook.result.current.check).toBe('taken');
    expect(hook.result.current.submit).toEqual({
      status: 'idle',
      errorCode: null,
      changeAvailableAt: null,
    });
    expect(routerCalls).toEqual([]);
  });

  it('shows the date when a second change is too soon', async () => {
    const cameBack = fixtureMe({
      handle: 'test_fixture',
      onboardingStep: 'issues',
      onboardedAt: null,
      handleChangeAvailableAt: '2027-02-14T12:00:00.000Z',
    });
    stub.use([FREE_CHECK, setHandleRoute(apiError(422, 'handle_change_too_soon'))]);
    const hook = mount(cameBack);
    expect(hook.result.current.initialHandle).toBe('test_fixture');

    await typed(hook, 'test_other');
    await pressContinue(hook);

    expect(hook.result.current.submit).toEqual({
      status: 'idle',
      errorCode: 'handle_change_too_soon',
      changeAvailableAt: '2027-02-14T12:00:00.000Z',
    });
    expect(routerCalls).toEqual([]);
  });

  it('continues with the handle the person already has', async () => {
    const cameBack = fixtureMe({ handle: 'test_fixture', onboardingStep: 'issues' });
    stub.use([setHandleRoute(json(200, cameBack))]);
    const hook = mount(cameBack);

    await pressContinue(hook);

    expect(stub.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['PUT', '/v1/me/handle', { handle: 'test_fixture' }],
    ]);
    expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/issues' }]);
  });

  it('sends nothing after the field is emptied', async () => {
    const cameBack = fixtureMe({ handle: 'test_fixture', onboardingStep: 'issues' });
    stub.use([setHandleRoute(json(200, cameBack))]);
    const hook = mount(cameBack);

    await typed(hook, '');
    expect(hook.result.current.check).toBe('idle');
    await pressContinue(hook);

    expect(puts()).toEqual([]);
  });

  it('does nothing while offline', async () => {
    stub.use([FREE_CHECK, setHandleRoute(json(200, NEW_PERSON))]);
    const hook = mount(NEW_PERSON);
    await typed(hook, 'test_new');

    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(hook.result.current.offline).toBe(true);
    await pressContinue(hook);

    expect(puts()).toEqual([]);
    expect(hook.result.current.submit.status).toBe('idle');
  });

  it('goes back to the photo step', () => {
    const hook = mount(NEW_PERSON);
    act(() => {
      hook.result.current.onBack();
    });
    expect(routerCalls).toEqual([{ op: 'replace', path: '/onboarding/photo' }]);
  });
});
