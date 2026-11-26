import type { Me } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache, writeMeToCache } from '@/features/system';
import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { fixtureMe, fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import type { ViewState } from '@/lib/view-state';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply } from '@/test/api-stub';
import { renderHookWithClient } from '@/test/render-hook';
import { sessionFake } from '@/test/platform/session';
import { resetRouterMock } from '@/test/router-mock';

import { useSettingsAccountViewModel } from './use-settings-account-view-model';

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

const NEW_EMAIL = 'new@example.test';
const START = {
  pendingToken: 'p'.repeat(43),
  expiresAt: '2027-01-15T12:10:00.000Z',
  resendAvailableAt: '2020-01-01T00:00:00.000Z',
};
const NO_EMAIL = fixtureMe({ email: null, signInMethods: ['apple'] });

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

function answerVerify(reply: StubReply, me: Me = NO_EMAIL): void {
  stub.use([
    { method: 'POST', path: '/v1/auth/email/start', reply: json(200, START) },
    { method: 'POST', path: '/v1/auth/email/verify', reply },
    { method: 'GET', path: '/v1/me', reply: json(200, me) },
  ]);
}

function dataOf<D>(view: ViewState<D>): D {
  if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
  return view.data;
}

function mount() {
  writeMeToCache(queryClient.get(), NO_EMAIL);
  return renderHookWithClient(() => useSettingsAccountViewModel());
}

type Hook = ReturnType<typeof mount>;

async function toCode(hook: Hook): Promise<void> {
  act(() => {
    dataOf(hook.result.current).onOpenAddEmail();
  });
  expect(dataOf(hook.result.current).addEmail.stage).toBe('email');
  act(() => {
    dataOf(hook.result.current).addEmail.email.onSubmit(NEW_EMAIL);
  });
  await waitFor(() => {
    expect(dataOf(hook.result.current).addEmail.stage).toBe('code');
  });
}

function submitCode(hook: Hook): void {
  act(() => {
    dataOf(hook.result.current).addEmail.code?.onSubmit('123456');
  });
}

function requestsTo(method: string, path: string) {
  return stub.requests.filter((request) => request.method === method && request.path === path);
}

describe('useSettingsAccountViewModel', () => {
  it('shows the account from Me with the sheet closed', () => {
    const hook = mount();

    const data = dataOf(hook.result.current);
    expect(data.me).toEqual(NO_EMAIL);
    expect(data.addEmail).toMatchObject({ stage: 'closed', code: null });
    expect(stub.requests).toEqual([]);
  });

  it('adds an email', async () => {
    const withEmail = fixtureMe({ email: NEW_EMAIL, signInMethods: ['apple', 'email'] });
    answerVerify(json(200, fixtureSessionInfo({ token: null, me: withEmail })));
    const hook = mount();

    await toCode(hook);
    submitCode(hook);

    await waitFor(() => {
      expect(dataOf(hook.result.current).addEmail.stage).toBe('closed');
    });
    expect(requestsTo('POST', '/v1/auth/email/verify').map((request) => request.body)).toEqual([
      { pendingToken: START.pendingToken, code: '123456', intent: 'add_email' },
    ]);
    expect(readMeFromCache(hook.client)?.email).toBe(NEW_EMAIL);
    expect(dataOf(hook.result.current).me.email).toBe(NEW_EMAIL);
    expect(sessionFake.calls.filter((call) => call.op === 'adopt')).toEqual([]);
  });

  it('shows an address that belongs to another account', async () => {
    answerVerify(apiError(409, 'email_in_use'));
    const hook = mount();

    await toCode(hook);
    submitCode(hook);

    await waitFor(() => {
      expect(dataOf(hook.result.current).addEmail.email.errorCode).toBe('email_in_use');
    });
    expect(dataOf(hook.result.current).addEmail.stage).toBe('email');
    expect(readMeFromCache(hook.client)?.email).toBeNull();
  });

  it('closes the sheet when an email was added elsewhere', async () => {
    const elsewhere = fixtureMe({ email: 'fixture@example.test' });
    answerVerify(apiError(409, 'email_already_set'), elsewhere);
    const hook = mount();

    await toCode(hook);
    submitCode(hook);

    await waitFor(() => {
      expect(requestsTo('GET', '/v1/me')).toHaveLength(1);
    });
    expect(dataOf(hook.result.current).addEmail.stage).toBe('closed');
    await waitFor(() => {
      expect(dataOf(hook.result.current).me.email).toBe('fixture@example.test');
    });
  });

  it('closes the sheet on request', async () => {
    answerVerify(json(200, fixtureSessionInfo({ token: null })));
    const hook = mount();
    await toCode(hook);

    act(() => {
      dataOf(hook.result.current).onCloseAddEmail();
    });

    expect(dataOf(hook.result.current).addEmail).toMatchObject({ stage: 'closed', code: null });
  });
});
