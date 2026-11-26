import type * as Shared from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setThemeChoice, useRootViewModel, writeMeToCache } from '@/features/system';
import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import type { ViewState } from '@/lib/view-state';
import { queryClient } from '@/platform/query-client';
import { configureTestApiClient, installApiStub } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { linksFake } from '@/test/platform/links';
import { queryClientFake } from '@/test/platform/query-client';
import { sessionFake } from '@/test/platform/session';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { useSettingsViewModel } from './use-settings-view-model';

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

// The brand module's support address, which stays null until the owner gives one
const brandDouble = vi.hoisted(() => ({ supportEmail: null as string | null }));

vi.mock('@citizenrun/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    BRAND: {
      ...actual.BRAND,
      contacts: {
        ...actual.BRAND.contacts,
        get supportEmail() {
          return brandDouble.supportEmail;
        },
      },
    },
  };
});

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([
    { method: 'POST', path: '/v1/auth/logout', reply: { kind: 'empty', status: 204 } },
  ]);
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  brandDouble.supportEmail = null;
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

function dataOf<D>(view: ViewState<D>): D {
  if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
  return view.data;
}

function mount() {
  writeMeToCache(queryClient.get(), fixtureMe());
  return renderHookWithClient(() => useSettingsViewModel());
}

describe('useSettingsViewModel', () => {
  it('builds the list from Me', () => {
    const hook = mount();

    expect(hook.result.current).toMatchObject({ status: 'ready', stale: false });
    const data = dataOf(hook.result.current);
    expect(data.me).toEqual(fixtureMe());
    expect(data.appVersion).toBe('1.0.0');
    expect(data.legal).toEqual({
      terms: 'http://api.test/terms',
      privacyPolicy: 'http://api.test/privacy',
      contentPolicy: 'http://api.test/content-policy',
    });
    expect(data.logoutStatus).toBe('idle');
    expect(stub.requests).toEqual([]);
  });

  it('logs out and goes to /', async () => {
    const hook = mount();

    act(() => {
      dataOf(hook.result.current).onLogout();
    });
    expect(dataOf(hook.result.current).logoutStatus).toBe('sending');

    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/' }]);
    });
    expect(stub.requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/v1/auth/logout'],
    ]);
    expect(sessionFake.calls).toContainEqual({ op: 'endLocal', reason: 'logout' });
  });

  it('logs out while offline', async () => {
    const hook = mount();
    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(hook.result.current).toMatchObject({ status: 'ready', stale: true });

    act(() => {
      dataOf(hook.result.current).onLogout();
    });

    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/' }]);
    });
    expect(sessionFake.calls).toContainEqual({ op: 'endLocal', reason: 'logout' });
  });

  it('opens a legal page outside the app', () => {
    const hook = mount();
    const { legal, onOpenLegal } = dataOf(hook.result.current);

    act(() => {
      onOpenLegal(legal.privacyPolicy);
    });

    expect(linksFake.calls).toEqual([{ op: 'openExternal', url: 'http://api.test/privacy' }]);
  });

  it("offers no support mail without the owner's address", () => {
    const hook = mount();

    const data = dataOf(hook.result.current);
    expect(data.supportEmail).toBeNull();
    expect(data.onContactSupport).toBeNull();
  });

  it('opens the mail app once the support address is set', () => {
    brandDouble.supportEmail = 'support@example.test';
    const hook = mount();

    const data = dataOf(hook.result.current);
    expect(data.supportEmail).toBe('support@example.test');
    act(() => {
      data.onContactSupport?.();
    });

    expect(linksFake.calls).toEqual([{ op: 'openMail' }]);
  });

  it('reports the appearance choice', async () => {
    writeMeToCache(queryClient.get(), fixtureMe());
    // The root view-model reads the device store at start, as the running app does
    const hook = renderHookWithClient(() => {
      useRootViewModel();
      return useSettingsViewModel();
    });
    await waitFor(() => {
      expect(sessionFake.calls).toContainEqual({ op: 'configure' });
    });
    expect(dataOf(hook.result.current).themeChoice).toBe('system');

    act(() => {
      setThemeChoice('dark');
    });

    expect(dataOf(hook.result.current).themeChoice).toBe('dark');
  });

  it('is loading until Me is known, and offline without it', () => {
    const hook = renderHookWithClient(() => useSettingsViewModel());
    expect(hook.result.current.status).toBe('loading');

    act(() => {
      queryClientFake.setOnline(false);
    });

    expect(hook.result.current.status).toBe('offline');
  });
});
