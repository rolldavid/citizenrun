import { LEGAL_VERSIONS } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache, writeMeToCache } from '@/features/system';
import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply } from '@/test/api-stub';
import { renderHookWithClient } from '@/test/render-hook';

import type { SettingsPrivacyViewModel } from './settings-privacy.types';
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

function answerConsent(reply: StubReply): void {
  stub.use([{ method: 'POST', path: '/v1/me/consents', reply }]);
}

function render() {
  writeMeToCache(queryClient.get(), ME);
  return renderHookWithClient(() => useSettingsPrivacyViewModel());
}

function readyData(vm: SettingsPrivacyViewModel) {
  if (vm.status !== 'ready') throw new Error(`expected ready, got ${vm.status}`);
  return vm.data;
}

function consentPosts() {
  return stub.requests.filter((request) => request.path === '/v1/me/consents');
}

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
  it('turns the AI check off', async () => {
    answerConsent(json(200, { ...ME.consents, aiScreening: 'declined' }));
    const hook = render();
    expect(readyData(hook.result.current).me.consents.aiScreening).toBe('granted');

    act(() => {
      readyData(hook.result.current).onSetAiScreening(false);
    });
    expect(readyData(hook.result.current)).toMatchObject({
      saving: 'aiScreening',
      errorCode: null,
    });

    await waitFor(() => {
      expect(readyData(hook.result.current).saving).toBeNull();
    });
    expect(consentPosts().map(({ method, body }) => ({ method, body }))).toEqual([
      {
        method: 'POST',
        body: { kind: 'ai_screening', version: LEGAL_VERSIONS.ai_screening, granted: false },
      },
    ]);
    expect(readyData(hook.result.current).me.consents.aiScreening).toBe('declined');
    expect(readMeFromCache(hook.client)?.consents.aiScreening).toBe('declined');
    expect(readyData(hook.result.current).errorCode).toBeNull();
  });

  it('keeps the old value and reports a failure', async () => {
    answerConsent(apiError(503, 'unavailable'));
    const hook = render();

    act(() => {
      readyData(hook.result.current).onSetAiScreening(false);
    });
    await waitFor(() => {
      expect(readyData(hook.result.current).saving).toBeNull();
    });
    expect(readyData(hook.result.current).errorCode).toBe('unavailable');
    expect(readyData(hook.result.current).me.consents.aiScreening).toBe('granted');

    answerConsent(json(200, { ...ME.consents, aiScreening: 'declined' }));
    act(() => {
      readyData(hook.result.current).onSetAiScreening(false);
    });
    expect(readyData(hook.result.current).errorCode).toBeNull();
    await waitFor(() => {
      expect(readyData(hook.result.current).saving).toBeNull();
    });
  });

  it('ignores a second change while saving', async () => {
    answerConsent({ kind: 'hang' });
    const hook = render();

    act(() => {
      readyData(hook.result.current).onSetAiScreening(false);
    });
    act(() => {
      readyData(hook.result.current).onSetAiScreening(true);
    });
    await waitFor(() => {
      expect(consentPosts()).toHaveLength(1);
    });
    expect(consentPosts()[0]?.body).toMatchObject({ granted: false });
    expect(readyData(hook.result.current).saving).toBe('aiScreening');
  });
});
