import type { Me, UploadTicket } from '@citizenrun/shared';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache, writeMeToCache } from '@/features/system';
import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { fixtureAvatar, fixtureMe } from '@/lib/view-models/__fixtures__/common';
import type { ViewState } from '@/lib/view-state';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply, StubRoute } from '@/test/api-stub';
import { queryClientFake } from '@/test/platform/query-client';
import { uploadFake } from '@/test/platform/upload';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock } from '@/test/router-mock';

import { useSettingsProfileViewModel } from './use-settings-profile-view-model';

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

const ME = fixtureMe({
  handle: 'test_fixture',
  name: 'Fixture Person',
  bio: null,
  link: null,
});

const SAME: { name: string | null; bio: string | null; link: string | null; handle: string } = {
  name: 'Fixture Person',
  bio: null,
  link: null,
  handle: 'test_fixture',
};

const TICKET: UploadTicket = {
  uploadId: '01890000-0000-7000-8000-0000000000c1',
  key: 'incoming/01890000-0000-7000-8000-000000000001/01890000-0000-7000-8000-0000000000c1.jpg',
  method: 'POST',
  url: 'https://store.example.test/media',
  fields: {},
  headers: {},
  maxBytes: 8_388_608,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

const FREE_CHECK: StubRoute = {
  method: 'GET',
  path: '/v1/handles/check',
  reply: (request) =>
    json(200, { handle: request.query['handle'] ?? '', available: true, reason: null }),
};

const TAKEN_CHECK: StubRoute = {
  method: 'GET',
  path: '/v1/handles/check',
  reply: (request) =>
    json(200, { handle: request.query['handle'] ?? '', available: false, reason: 'taken' }),
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

function patchRoute(reply: StubReply | ((index: number) => StubReply)): StubRoute {
  return {
    method: 'PATCH',
    path: '/v1/me',
    reply: (_request, index) => (typeof reply === 'function' ? reply(index) : reply),
  };
}

function handleRoute(reply: StubReply): StubRoute {
  return { method: 'PUT', path: '/v1/me/handle', reply };
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

function dataOf<D>(view: ViewState<D>): D {
  if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
  return view.data;
}

function mount(me: Me = ME) {
  writeMeToCache(queryClient.get(), me);
  return renderHookWithClient(() => useSettingsProfileViewModel());
}

type Hook = ReturnType<typeof mount>;

function data(hook: Hook) {
  return dataOf(hook.result.current);
}

async function typeHandle(hook: Hook, value: string): Promise<void> {
  act(() => {
    data(hook).handle.onChange(value);
  });
  await settle(300);
}

async function save(hook: Hook, input: typeof SAME): Promise<void> {
  act(() => {
    data(hook).onSave(input);
  });
  await settle();
}

function writes() {
  return stub.requests
    .filter((request) => request.method !== 'GET')
    .map((request) => [request.method, request.path, request.body]);
}

describe('useSettingsProfileViewModel', () => {
  it('saves a changed name and bio in one patch', async () => {
    const saved = fixtureMe({ ...ME, name: 'Fixture Renamed', bio: 'Fixture bio.' });
    stub.use([patchRoute(json(200, saved))]);
    const hook = mount(fixtureMe({ ...ME, consents: fixtureMe().consents }));

    act(() => {
      data(hook).onSave({ ...SAME, name: ' Fixture Renamed ', bio: 'Fixture bio.' });
    });
    expect(data(hook).save).toEqual({ status: 'sending', fields: {}, errorCode: null });
    await settle();

    expect(writes()).toEqual([
      ['PATCH', '/v1/me', { name: 'Fixture Renamed', bio: 'Fixture bio.' }],
    ]);
    expect(data(hook).save).toEqual({ status: 'saved', fields: {}, errorCode: null });
    expect(readMeFromCache(hook.client)?.name).toBe('Fixture Renamed');
    expect(data(hook).me.bio).toBe('Fixture bio.');
  });

  it('sends a changed handle after the patch', async () => {
    stub.use([
      FREE_CHECK,
      patchRoute(json(200, fixtureMe({ ...ME, name: 'Fixture Renamed' }))),
      handleRoute(json(200, fixtureMe({ ...ME, name: 'Fixture Renamed', handle: 'test_new' }))),
    ]);
    const hook = mount();

    await typeHandle(hook, 'test_new');
    expect(data(hook).handle.check).toBe('free');
    await save(hook, { ...SAME, name: 'Fixture Renamed', handle: 'test_new' });

    expect(writes()).toEqual([
      ['PATCH', '/v1/me', { name: 'Fixture Renamed' }],
      ['PUT', '/v1/me/handle', { handle: 'test_new' }],
    ]);
    expect(data(hook).save.status).toBe('saved');
    expect(readMeFromCache(hook.client)?.handle).toBe('test_new');
  });

  it('sends only the handle when nothing else changed', async () => {
    stub.use([FREE_CHECK, handleRoute(json(200, fixtureMe({ ...ME, handle: 'test_new' })))]);
    const hook = mount();

    await typeHandle(hook, 'test_new');
    await save(hook, { ...SAME, handle: 'test_new' });

    expect(writes()).toEqual([['PUT', '/v1/me/handle', { handle: 'test_new' }]]);
    expect(data(hook).save.status).toBe('saved');
  });

  it('shows field errors', async () => {
    stub.use([
      FREE_CHECK,
      patchRoute(apiError(400, 'invalid_request', { fields: { name: 'too_long' } })),
      handleRoute(json(200, ME)),
    ]);
    const hook = mount();

    await typeHandle(hook, 'test_new');
    await save(hook, { ...SAME, name: 'Fixture Renamed', handle: 'test_new' });

    expect(data(hook).save).toEqual({
      status: 'idle',
      fields: { name: 'too_long' },
      errorCode: null,
    });
    expect(writes()).toEqual([['PATCH', '/v1/me', { name: 'Fixture Renamed' }]]);
    expect(data(hook).me.name).toBe('Fixture Person');
  });

  it('saves a first bio with no AI question and no consent request', async () => {
    const saved = fixtureMe({ ...ME, bio: 'Fixture bio.' });
    stub.use([patchRoute(() => json(200, saved))]);
    const hook = mount();

    await save(hook, { ...SAME, bio: 'Fixture bio.' });

    expect(writes()).toEqual([['PATCH', '/v1/me', { bio: 'Fixture bio.' }]]);
    expect(Object.keys(data(hook))).not.toContain('aiConsentNeeded');
    expect(Object.keys(data(hook))).not.toContain('onAnswerAiConsent');
    expect(data(hook).save.status).toBe('saved');
    expect(readMeFromCache(hook.client)?.bio).toBe('Fixture bio.');
  });

  it("keeps the field's taken state when the handle was taken meanwhile", async () => {
    stub.use([FREE_CHECK, handleRoute(apiError(409, 'handle_taken'))]);
    const hook = mount();

    await typeHandle(hook, 'test_new');
    await save(hook, { ...SAME, handle: 'test_new' });

    expect(data(hook).handle.check).toBe('taken');
    expect(data(hook).save).toEqual({ status: 'idle', fields: {}, errorCode: null });
  });

  it('shows the date when the handle changed too recently', async () => {
    stub.use([FREE_CHECK, handleRoute(apiError(422, 'handle_change_too_soon'))]);
    const hook = mount();

    await typeHandle(hook, 'test_new');
    await save(hook, { ...SAME, handle: 'test_new' });

    expect(data(hook).save).toEqual({
      status: 'idle',
      fields: {},
      errorCode: 'handle_change_too_soon',
    });
  });

  it('keeps the patched fields when the handle is refused', async () => {
    stub.use([
      FREE_CHECK,
      patchRoute(json(200, fixtureMe({ ...ME, name: 'Fixture Renamed' }))),
      handleRoute(apiError(422, 'handle_change_too_soon')),
    ]);
    const hook = mount();

    await typeHandle(hook, 'test_new');
    await save(hook, { ...SAME, name: 'Fixture Renamed', handle: 'test_new' });

    expect(readMeFromCache(hook.client)?.name).toBe('Fixture Renamed');
    expect(data(hook).save.errorCode).toBe('handle_change_too_soon');
  });

  it('sends no handle the field shows as taken', async () => {
    stub.use([TAKEN_CHECK, handleRoute(json(200, ME))]);
    const hook = mount();

    await typeHandle(hook, 'test_new');
    expect(data(hook).handle.check).toBe('taken');
    await save(hook, { ...SAME, handle: 'test_new' });

    expect(writes()).toEqual([]);
    expect(data(hook).save.status).toBe('idle');
  });

  it('uploads and attaches a new photo at once', async () => {
    const attached = fixtureMe({ ...ME, avatar: fixtureAvatar(), avatarPending: true });
    stub.use([
      { method: 'POST', path: '/v1/uploads', reply: json(201, TICKET) },
      patchRoute(json(200, attached)),
    ]);
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
    const hook = mount();

    act(() => {
      data(hook).onChoosePhoto();
    });
    await settle();

    expect(uploadFake.calls.filter((call) => call.op === 'send')).toHaveLength(1);
    expect(writes()).toEqual([
      ['POST', '/v1/uploads', expect.objectContaining({ purpose: 'avatar' }) as unknown],
      ['PATCH', '/v1/me', { avatarUploadKey: TICKET.key }],
    ]);
    expect(data(hook).photo).toEqual({ status: 'none' });
    expect(data(hook).me.avatarPending).toBe(true);
  });

  it('removes the photo', async () => {
    const withAvatar = fixtureMe({ ...ME, avatar: fixtureAvatar() });
    stub.use([patchRoute(json(200, fixtureMe({ ...ME, avatar: null })))]);
    const hook = mount(withAvatar);

    act(() => {
      data(hook).onRemovePhoto();
    });
    await settle();

    expect(writes()).toEqual([['PATCH', '/v1/me', { avatarUploadKey: null }]]);
    expect(data(hook).me.avatar).toBeNull();
  });

  it('shows a refused photo removal', async () => {
    stub.use([patchRoute(apiError(429, 'rate_limited'))]);
    const hook = mount(fixtureMe({ ...ME, avatar: fixtureAvatar() }));

    act(() => {
      data(hook).onRemovePhoto();
    });
    await settle();

    expect(data(hook).save.errorCode).toBe('rate_limited');
    expect(data(hook).me.avatar).not.toBeNull();
  });

  it('does nothing while offline', async () => {
    stub.use([FREE_CHECK, patchRoute(json(200, ME)), handleRoute(json(200, ME))]);
    const hook = mount();
    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(hook.result.current).toMatchObject({ status: 'ready', stale: true });

    await save(hook, { ...SAME, name: 'Fixture Renamed', handle: 'test_new' });
    act(() => {
      data(hook).onRemovePhoto();
      data(hook).onChoosePhoto();
    });
    await settle();

    expect(writes()).toEqual([]);
    expect(uploadFake.calls).toEqual([]);
    expect(data(hook).save.status).toBe('idle');
  });

  it('sends nothing when nothing changed', async () => {
    stub.use([patchRoute(json(200, ME))]);
    const hook = mount();

    await save(hook, { ...SAME, name: ' Fixture Person ' });

    expect(writes()).toEqual([]);
    expect(data(hook).save.status).toBe('idle');
  });
});
