import type { Me } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache, writeMeToCache } from '@/features/system';
import { resetNavigationState } from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence } from '@/lib/session-state';
import { fixtureMe, fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply } from '@/test/api-stub';
import { sessionFake } from '@/test/platform/session';
import { renderHookWithClient } from '@/test/render-hook';

import { useReauth } from './use-reauth';

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

const PENDING = 'p'.repeat(43);
const START = {
  pendingToken: PENDING,
  expiresAt: '2027-01-15T12:10:00.000Z',
  resendAvailableAt: '2020-01-01T00:00:00.000Z',
};
const RENEWED = fixtureSessionInfo({
  token: 'r'.repeat(43),
  me: fixtureMe({
    session: {
      platform: 'ios',
      authenticatedAt: '2027-01-15T13:00:00.000Z',
      expiresAt: '2027-04-15T13:00:00.000Z',
      sensitiveActionsUntil: '2027-01-15T13:15:00.000Z',
    },
  }),
});

let stub: ApiStub;
const action = vi.fn<() => void>();

function answerVerify(reply: StubReply): void {
  stub.use([
    {
      method: 'POST',
      path: '/v1/auth/nonce',
      reply: json(200, {
        nonce: 'n'.repeat(43),
        nonceHash: 'fixture-hash',
        state: 's'.repeat(43),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    },
    { method: 'POST', path: '/v1/auth/email/start', reply: json(200, START) },
    { method: 'POST', path: '/v1/auth/email/verify', reply },
  ]);
}

function render(me: Me = fixtureMe()) {
  writeMeToCache(queryClient.get(), me);
  return renderHookWithClient(() => useReauth());
}

type Hook = ReturnType<typeof render>;

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function openAndSendCode(hook: Hook): Promise<void> {
  act(() => {
    hook.result.current.openFor(action);
  });
  act(() => {
    hook.result.current.vm.onSendCode();
  });
  await waitFor(() => {
    expect(hook.result.current.vm.code).not.toBeNull();
  });
}

function submitCode(hook: Hook): void {
  act(() => {
    hook.result.current.vm.code?.onSubmit('123456');
  });
}

function nonceRequests() {
  return stub.requests.filter((request) => request.path === '/v1/auth/nonce');
}

beforeEach(() => {
  stub = installApiStub([]);
  answerVerify(json(200, RENEWED));
  configureTestApiClient();
  action.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNavigationState();
  resetSessionPresence();
});

describe('useReauth', () => {
  it('runs the action at once after a recent sign-in', () => {
    const hook = render();
    act(() => {
      hook.result.current.run(minutesFromNow(1), action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(hook.result.current.vm.open).toBe(false);
  });

  it('opens the sheet when the sign-in is too old', () => {
    const hook = render();
    act(() => {
      hook.result.current.run(minutesFromNow(-1), action);
    });
    expect(hook.result.current.vm.open).toBe(true);
    expect(action).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.run(null, action);
    });
    expect(action).not.toHaveBeenCalled();
  });

  it('sends the code to the account address', async () => {
    const hook = render(fixtureMe({ email: 'fixture@example.test' }));
    await openAndSendCode(hook);
    expect(stub.requests.filter((request) => request.path === '/v1/auth/email/start')).toEqual([
      expect.objectContaining({ method: 'POST', body: { email: 'fixture@example.test' } }),
    ]);
    expect(hook.result.current.vm.code?.sentTo).toBe('fixture@example.test');
  });

  it('runs the action once after the code signs in again', async () => {
    const hook = render();
    await openAndSendCode(hook);
    submitCode(hook);
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });

    expect(stub.requests.find((request) => request.path === '/v1/auth/email/verify')?.body).toEqual(
      { pendingToken: PENDING, code: '123456', intent: 'reauth' },
    );
    expect(sessionFake.calls).toEqual([{ op: 'adopt', hasToken: true }]);
    expect(readMeFromCache(hook.client)).toEqual(RENEWED.me);
    expect(getSessionPresence()).toBe('present');
    expect(hook.result.current.vm.open).toBe(false);

    submitCode(hook);
    await waitFor(() => {
      expect(sessionFake.calls).toHaveLength(2);
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('reports a different account', async () => {
    answerVerify(apiError(409, 'reauth_mismatch'));
    const hook = render();
    await openAndSendCode(hook);
    submitCode(hook);
    await waitFor(() => {
      expect(hook.result.current.vm.notice?.code).toBe('reauth_mismatch');
    });
    expect(hook.result.current.vm.open).toBe(true);
    expect(hook.result.current.vm.code).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it('offers only the methods the account has', () => {
    const hook = render(fixtureMe({ signInMethods: ['email', 'apple'], email: null }));
    expect(hook.result.current.vm.methods).toEqual(['apple']);
    const withEmail = render(fixtureMe({ signInMethods: ['email', 'google'] }));
    expect(withEmail.result.current.vm.methods).toEqual(['email', 'google']);
  });

  it('forgets the action when closed', async () => {
    const hook = render();
    await openAndSendCode(hook);
    const submitLater = hook.result.current.vm.code?.onSubmit;
    act(() => {
      hook.result.current.vm.onClose();
    });
    expect(hook.result.current.vm.open).toBe(false);
    expect(hook.result.current.vm.code).toBeNull();

    act(() => {
      submitLater?.('123456');
    });
    await waitFor(() => {
      expect(
        stub.requests.filter((request) => request.path === '/v1/auth/email/verify'),
      ).toHaveLength(1);
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    });
    expect(action).not.toHaveBeenCalled();
  });

  it('asks for no nonce while closed', async () => {
    const hook = render();
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    });
    expect(nonceRequests()).toEqual([]);

    act(() => {
      hook.result.current.openFor(action);
    });
    await waitFor(() => {
      expect(nonceRequests()).toHaveLength(1);
    });
  });
});
