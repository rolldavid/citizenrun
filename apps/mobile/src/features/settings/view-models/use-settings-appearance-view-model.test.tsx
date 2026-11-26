import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRootViewModel } from '@/features/system';
import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { configureTestApiClient, installApiStub } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { sessionFake } from '@/test/platform/session';
import { storageFake } from '@/test/platform/storage';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock } from '@/test/router-mock';

import { useSettingsAppearanceViewModel } from './use-settings-appearance-view-model';

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
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

// The root view-model hydrates the device store at start, as the running app does
async function mountInApp() {
  const hook = renderHookWithClient(() => {
    useRootViewModel();
    return useSettingsAppearanceViewModel();
  });
  // The session is configured right after the store is read
  await waitFor(() => {
    expect(sessionFake.calls).toContainEqual({ op: 'configure' });
  });
  return hook;
}

describe('useSettingsAppearanceViewModel', () => {
  it('shows the stored choice', async () => {
    storageFake.seed({ theme: 'light' });
    const hook = await mountInApp();

    expect(hook.result.current.choice).toBe('light');
    expect(stub.requests).toEqual([]);
  });

  it('writes a new choice to the device store', async () => {
    const hook = await mountInApp();
    expect(hook.result.current.choice).toBe('system');

    act(() => {
      hook.result.current.onChange('dark');
    });

    expect(storageFake.calls).toContainEqual({ op: 'set', key: 'theme' });
    expect(hook.result.current.choice).toBe('dark');
    // The root view-model's own Me query aside, nothing is requested
    expect(stub.requests.filter((request) => request.path !== '/v1/me')).toEqual([]);
  });
});
