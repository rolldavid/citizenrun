import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeMeToCache } from '@/features/system';
import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { configureTestApiClient, installApiStub } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { renderHookWithClient } from '@/test/render-hook';

import { useSettingsPrivacyViewModel } from './use-settings-privacy-view-model';

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

const ME = fixtureMe();

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNavigationState();
  resetSessionPresence();
});

describe('useSettingsPrivacyViewModel', () => {
  it('is ready with the person from the cache', () => {
    writeMeToCache(queryClient.get(), ME);
    const hook = renderHookWithClient(() => useSettingsPrivacyViewModel());
    const vm = hook.result.current;
    if (vm.status !== 'ready') throw new Error(`expected ready, got ${vm.status}`);
    expect(vm.data).toEqual({ me: ME });
  });

  it('offers no AI-screening choice and records no consent', () => {
    writeMeToCache(queryClient.get(), ME);
    const hook = renderHookWithClient(() => useSettingsPrivacyViewModel());
    const vm = hook.result.current;
    if (vm.status !== 'ready') throw new Error(`expected ready, got ${vm.status}`);
    // The person and nothing to answer: no callback, no saving state (D-900).
    expect(Object.keys(vm.data)).toEqual(['me']);
    expect(vm.data.me.consents).not.toHaveProperty('aiScreening');
    expect(stub.requests.filter((request) => request.path === '/v1/me/consents')).toEqual([]);
  });
});
