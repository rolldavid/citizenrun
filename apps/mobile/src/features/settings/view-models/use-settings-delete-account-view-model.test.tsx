import type { Me } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeMeToCache } from '@/features/system';
import {
  markNavigationReady,
  peekRememberedNext,
  rememberNext,
  resetNavigationState,
} from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { fixtureMe, fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { session } from '@/platform/session';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply, StubRoute } from '@/test/api-stub';
import { sessionFake } from '@/test/platform/session';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import type { SettingsDeleteViewModel } from './settings-delete-account.types';
import { useSettingsDeleteAccountViewModel } from './use-settings-delete-account-view-model';

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

const DELETION = {
  deletionRequestedAt: '2027-01-15T12:00:00.000Z',
  completesBy: '2027-01-16T12:00:00.000Z',
};

let stub: ApiStub;

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function meSignedIn(minutesLeft: number, overrides: Partial<Me> = {}): Me {
  return fixtureMe({
    session: {
      platform: 'ios',
      authenticatedAt: minutesFromNow(minutesLeft - 15),
      expiresAt: '2027-04-15T12:00:00.000Z',
      sensitiveActionsUntil: minutesFromNow(minutesLeft),
    },
    ...overrides,
  });
}

function answerDelete(reply: StubReply): void {
  const routes: StubRoute[] = [
    { method: 'DELETE', path: '/v1/me', reply },
    {
      method: 'POST',
      path: '/v1/auth/nonce',
      reply: () =>
        json(200, {
          nonce: 'n'.repeat(43),
          nonceHash: 'fixture-hash',
          state: 's'.repeat(43),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
    },
    {
      method: 'POST',
      path: '/v1/auth/email/start',
      reply: json(200, {
        pendingToken: 'p'.repeat(43),
        expiresAt: minutesFromNow(10),
        resendAvailableAt: minutesFromNow(0.5),
      }),
    },
    {
      method: 'POST',
      path: '/v1/auth/email/verify',
      reply: json(200, fixtureSessionInfo({ me: meSignedIn(15) })),
    },
  ];
  stub.use(routes);
}

/** The real endLocal empties the query cache (PM-session-tokens); the fake only records the call. */
function endLocalEmptiesTheCache(): void {
  const record = session.endLocal.bind(session);
  vi.spyOn(session, 'endLocal').mockImplementation(async (reason) => {
    await record(reason);
    queryClient.get().clear();
  });
}

function render(me: Me) {
  writeMeToCache(queryClient.get(), me);
  setSessionPresence('present');
  return renderHookWithClient(() => useSettingsDeleteAccountViewModel());
}

function readyData(vm: SettingsDeleteViewModel) {
  if (vm.status !== 'ready') throw new Error(`expected ready, got ${vm.status}`);
  return vm.data;
}

function deletes() {
  return stub.requests.filter((request) => request.method === 'DELETE');
}

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

async function expectDeletedAndSignedOut(hook: ReturnType<typeof render>, me: Me): Promise<void> {
  await waitFor(() => {
    expect(routerCalls).toEqual([{ op: 'replace', path: '/' }]);
  });
  expect(deletes().map(({ path, body }) => ({ path, body }))).toEqual([
    { path: '/v1/me', body: null },
  ]);
  expect(sessionFake.calls).toEqual([{ op: 'endLocal', reason: 'account_deleted' }]);
  expect(getSessionPresence()).toBe('absent');
  expect(peekRememberedNext()).toBeNull();
  expect(queryClient.get().getQueryCache().getAll()).toEqual([]);
  expect(hook.result.current).toMatchObject({ status: 'ready' });
  expect(readyData(hook.result.current)).toMatchObject({ status: 'deleted', me });
}

describe('useSettingsDeleteAccountViewModel', () => {
  it('asks before deleting', () => {
    answerDelete(json(202, DELETION));
    const hook = render(meSignedIn(1));
    expect(readyData(hook.result.current)).toMatchObject({
      status: 'idle',
      exportHref: '/settings/export',
    });

    act(() => {
      readyData(hook.result.current).onAskDelete();
    });
    expect(readyData(hook.result.current).status).toBe('confirming');
    act(() => {
      readyData(hook.result.current).onCancel();
    });
    expect(readyData(hook.result.current).status).toBe('idle');
    expect(deletes()).toEqual([]);
  });

  it('deletes after a recent sign-in and ends the session with account_deleted', async () => {
    answerDelete(json(202, DELETION));
    endLocalEmptiesTheCache();
    rememberNext('/settings');
    const me = meSignedIn(1);
    const hook = render(me);

    act(() => {
      readyData(hook.result.current).onAskDelete();
    });
    act(() => {
      readyData(hook.result.current).onConfirm();
    });
    expect(readyData(hook.result.current).status).toBe('deleting');

    await expectDeletedAndSignedOut(hook, me);
  });

  it('signs in again first after an old sign-in', async () => {
    answerDelete(json(202, DELETION));
    const hook = render(meSignedIn(-1));

    act(() => {
      readyData(hook.result.current).onAskDelete();
    });
    act(() => {
      readyData(hook.result.current).onConfirm();
    });
    expect(readyData(hook.result.current).reauth.open).toBe(true);
    act(() => {
      readyData(hook.result.current).reauth.onSendCode();
    });
    await waitFor(() => {
      expect(readyData(hook.result.current).reauth.code).not.toBeNull();
    });
    expect(deletes()).toEqual([]);

    act(() => {
      readyData(hook.result.current).reauth.code?.onSubmit('123456');
    });
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/' }]);
    });
    expect(deletes()).toHaveLength(1);
    expect(sessionFake.calls).toEqual([
      { op: 'adopt', hasToken: true },
      { op: 'endLocal', reason: 'account_deleted' },
    ]);
  });

  it('opens the sheet when the server asks', async () => {
    answerDelete(apiError(403, 'recent_sign_in_required'));
    const hook = render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onAskDelete();
    });
    act(() => {
      readyData(hook.result.current).onConfirm();
    });
    await waitFor(() => {
      expect(readyData(hook.result.current).reauth.open).toBe(true);
    });
    expect(readyData(hook.result.current)).toMatchObject({ status: 'confirming', errorCode: null });
    expect(deletes()).toHaveLength(1);
    expect(sessionFake.calls).toEqual([]);
  });

  it('keeps the account when the request fails', async () => {
    answerDelete(apiError(503, 'unavailable'));
    const hook = render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onAskDelete();
    });
    act(() => {
      readyData(hook.result.current).onConfirm();
    });
    await waitFor(() => {
      expect(readyData(hook.result.current).status).toBe('idle');
    });
    expect(readyData(hook.result.current).errorCode).toBe('unavailable');
    expect(sessionFake.calls).toEqual([]);
    expect(getSessionPresence()).toBe('present');
    expect(routerCalls).toEqual([]);

    act(() => {
      readyData(hook.result.current).onAskDelete();
    });
    expect(readyData(hook.result.current)).toMatchObject({ status: 'confirming', errorCode: null });
  });

  it('lets a suspended account delete', async () => {
    answerDelete(json(202, DELETION));
    endLocalEmptiesTheCache();
    const me = meSignedIn(1, {
      status: 'suspended',
      suspension: { reason: 'spam', since: '2027-01-10T09:00:00.000Z' },
    });
    const hook = render(me);

    act(() => {
      readyData(hook.result.current).onAskDelete();
    });
    act(() => {
      readyData(hook.result.current).onConfirm();
    });

    await expectDeletedAndSignedOut(hook, me);
  });
});
