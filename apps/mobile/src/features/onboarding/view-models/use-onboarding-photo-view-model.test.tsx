import type { UploadTicket } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache } from '@/features/system';
import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubRoute } from '@/test/api-stub';
import { linksFake } from '@/test/platform/links';
import { queryClientFake } from '@/test/platform/query-client';
import { uploadFake } from '@/test/platform/upload';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { useOnboardingPhotoViewModel } from './use-onboarding-photo-view-model';

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

function ticketNumber(index: number): UploadTicket {
  const id = `01890000-0000-7000-8000-0000000000c${String(index)}`;
  return {
    uploadId: id,
    key: `incoming/01890000-0000-7000-8000-000000000001/${id}.jpg`,
    method: 'POST',
    url: 'https://store.example.test/media',
    fields: {},
    headers: {},
    maxBytes: 8_388_608,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

const TICKETS: StubRoute = {
  method: 'POST',
  path: '/v1/uploads',
  reply: (_request, index) => json(201, ticketNumber(index)),
};

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([TICKETS]);
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
});

function scriptPhoto(): void {
  uploadFake.scriptPick({
    kind: 'picked',
    items: [
      {
        kind: 'photo',
        previewUri: 'blob:fixture-picked',
        width: 4000,
        height: 3000,
        mimeType: 'image/jpeg',
        fileSize: 480_000,
      },
    ],
    truncated: false,
  });
}

async function withPhoto() {
  const hook = renderHookWithClient(() => useOnboardingPhotoViewModel());
  scriptPhoto();
  act(() => {
    hook.result.current.onChoose();
  });
  await waitFor(() => {
    expect(hook.result.current.photo.status).toBe('ready');
  });
  return hook;
}

function requestsTo(method: string, path: string) {
  return stub.requests.filter((request) => request.method === method && request.path === path);
}

describe('useOnboardingPhotoViewModel', () => {
  it('continues with the photo', async () => {
    const me = fixtureMe({ onboardingStep: 'handle', avatarPending: true });
    stub.use([TICKETS, { method: 'PATCH', path: '/v1/me', reply: json(200, me) }]);
    const hook = await withPhoto();

    act(() => {
      hook.result.current.onContinue();
    });

    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/handle' }]);
    });
    expect(requestsTo('POST', '/v1/uploads')).toHaveLength(1);
    expect(uploadFake.calls.filter((call) => call.op === 'send')).toHaveLength(1);
    expect(requestsTo('PATCH', '/v1/me').map((request) => request.body)).toEqual([
      { avatarUploadKey: ticketNumber(0).key },
    ]);
    expect(readMeFromCache(hook.client)?.onboardingStep).toBe('handle');
  });

  it('skips the photo', async () => {
    const me = fixtureMe({ onboardingStep: 'handle' });
    stub.use([{ method: 'POST', path: '/v1/me/onboarding/skip', reply: json(200, me) }]);
    const hook = renderHookWithClient(() => useOnboardingPhotoViewModel());

    act(() => {
      hook.result.current.onSkip();
    });
    expect(hook.result.current.skipStatus).toBe('sending');

    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/handle' }]);
    });
    expect(stub.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['POST', '/v1/me/onboarding/skip', { step: 'photo' }],
    ]);
    expect(hook.result.current.skipStatus).toBe('idle');
    expect(readMeFromCache(hook.client)?.onboardingStep).toBe('handle');
  });

  it('shows a refused skip', async () => {
    stub.use([
      { method: 'POST', path: '/v1/me/onboarding/skip', reply: apiError(429, 'rate_limited') },
    ]);
    const hook = renderHookWithClient(() => useOnboardingPhotoViewModel());

    act(() => {
      hook.result.current.onSkip();
    });

    await waitFor(() => {
      expect(hook.result.current.photo).toEqual({
        status: 'failed',
        previewUri: null,
        failure: 'rate_limited',
      });
    });
    expect(hook.result.current.skipStatus).toBe('idle');
    expect(routerCalls).toEqual([]);
  });

  it('asks for a new ticket after a refused attach', async () => {
    stub.use([
      TICKETS,
      {
        method: 'PATCH',
        path: '/v1/me',
        reply: (_request, index) =>
          index === 0
            ? apiError(422, 'upload_invalid')
            : json(200, fixtureMe({ onboardingStep: 'handle' })),
      },
    ]);
    const hook = await withPhoto();

    act(() => {
      hook.result.current.onContinue();
    });
    await waitFor(() => {
      expect(hook.result.current.photo).toMatchObject({
        status: 'failed',
        failure: 'upload_failed',
      });
    });
    expect(routerCalls).toEqual([]);

    act(() => {
      hook.result.current.onContinue();
    });
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/handle' }]);
    });
    expect(requestsTo('POST', '/v1/uploads')).toHaveLength(2);
    expect(requestsTo('PATCH', '/v1/me').map((request) => request.body)).toEqual([
      { avatarUploadKey: ticketNumber(0).key },
      { avatarUploadKey: ticketNumber(1).key },
    ]);
  });

  it('ignores Continue without a photo', async () => {
    const hook = renderHookWithClient(() => useOnboardingPhotoViewModel());

    await act(async () => {
      hook.result.current.onContinue();
      await Promise.resolve();
    });

    expect(stub.requests).toEqual([]);
    expect(uploadFake.calls).toEqual([]);
    expect(hook.result.current.photo).toEqual({ status: 'none' });
  });

  it('does nothing while offline', async () => {
    const hook = await withPhoto();
    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(hook.result.current.offline).toBe(true);

    await act(async () => {
      hook.result.current.onContinue();
      hook.result.current.onSkip();
      await Promise.resolve();
    });

    expect(stub.requests).toEqual([]);
    expect(uploadFake.calls.filter((call) => call.op === 'send')).toEqual([]);
    expect(hook.result.current.photo.status).toBe('ready');
    expect(hook.result.current.skipStatus).toBe('idle');
  });

  it('opens the app settings', () => {
    const hook = renderHookWithClient(() => useOnboardingPhotoViewModel());
    const before = { photo: hook.result.current.photo, skipStatus: hook.result.current.skipStatus };

    act(() => {
      hook.result.current.onOpenSettings();
    });
    act(() => {
      queryClientFake.setOnline(false);
    });
    act(() => {
      hook.result.current.onOpenSettings();
    });

    expect(linksFake.calls).toEqual([{ op: 'openAppSettings' }, { op: 'openAppSettings' }]);
    expect({
      photo: hook.result.current.photo,
      skipStatus: hook.result.current.skipStatus,
    }).toEqual(before);
    expect(stub.requests).toEqual([]);
  });
});
