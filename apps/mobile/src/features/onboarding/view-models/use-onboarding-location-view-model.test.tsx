import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache, writeMeToCache } from '@/features/system';
import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { useOnboardingLocationViewModel } from './use-onboarding-location-view-model';

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

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
  markNavigationReady();
  writeMeToCache(queryClient.get(), fixtureMe({ onboardingStep: 'location', onboardedAt: null }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
});

describe('useOnboardingLocationViewModel', () => {
  it('ends sign-up by skipping the location', async () => {
    stub.use([
      {
        method: 'POST',
        path: '/v1/me/onboarding/skip',
        reply: json(200, fixtureMe({ onboardingStep: 'done' })),
      },
    ]);
    const hook = renderHookWithClient(() => useOnboardingLocationViewModel());

    act(() => {
      hook.result.current.onSkip();
    });
    expect(hook.result.current.skipStatus).toBe('sending');

    await waitFor(() => {
      expect(readMeFromCache(hook.client)?.onboardingStep).toBe('done');
    });
    expect(stub.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['POST', '/v1/me/onboarding/skip', { step: 'location' }],
    ]);
    expect(hook.result.current).toMatchObject({ skipStatus: 'idle', errorCode: null });
    expect(routerCalls).toEqual([]);
  });

  it('shows a refusal', async () => {
    stub.use([
      {
        method: 'POST',
        path: '/v1/me/onboarding/skip',
        reply: apiError(409, 'onboarding_step_mismatch'),
      },
    ]);
    const hook = renderHookWithClient(() => useOnboardingLocationViewModel());

    act(() => {
      hook.result.current.onSkip();
    });

    await waitFor(() => {
      expect(hook.result.current.errorCode).toBe('onboarding_step_mismatch');
    });
    expect(hook.result.current.skipStatus).toBe('idle');
    expect(readMeFromCache(hook.client)?.onboardingStep).toBe('location');
    expect(routerCalls).toEqual([]);
  });

  it('does nothing while offline', async () => {
    const hook = renderHookWithClient(() => useOnboardingLocationViewModel());
    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(hook.result.current.offline).toBe(true);

    await act(async () => {
      hook.result.current.onSkip();
      await Promise.resolve();
    });

    expect(stub.requests).toEqual([]);
    expect(hook.result.current.skipStatus).toBe('idle');
  });

  it('goes back to the issues', () => {
    const hook = renderHookWithClient(() => useOnboardingLocationViewModel());
    act(() => {
      hook.result.current.onBack();
    });
    expect(routerCalls).toEqual([{ op: 'replace', path: '/onboarding/issues' }]);
  });
});
