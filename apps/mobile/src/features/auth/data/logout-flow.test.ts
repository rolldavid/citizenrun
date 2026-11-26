import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { peekRememberedNext, rememberNext, resetNavigationState } from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { apiError, configureTestApiClient, installApiStub } from '@/test/api-stub';
import type { ApiStub, StubReply } from '@/test/api-stub';
import { sessionFake } from '@/test/platform/session';

import { LOGOUT_TIMEOUT_MS, logout } from './logout';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

let stub: ApiStub;

function answer(reply: StubReply | ((callIndex: number) => StubReply)): void {
  stub.use([
    {
      method: 'POST',
      path: '/v1/auth/logout',
      reply: (_request, index) => (typeof reply === 'function' ? reply(index) : reply),
    },
  ]);
}

function endLocalCalls() {
  return sessionFake.calls.filter((call) => call.op === 'endLocal');
}

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
  setSessionPresence('present');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetNavigationState();
  resetSessionPresence();
});

describe('logout', () => {
  it('ends the session after the request answers', async () => {
    const endedBeforeAnswer: number[] = [];
    answer(() => {
      endedBeforeAnswer.push(endLocalCalls().length);
      return { kind: 'empty', status: 204 };
    });
    rememberNext('/settings');

    await logout();

    expect(endedBeforeAnswer).toEqual([0]);
    expect(endLocalCalls()).toEqual([{ op: 'endLocal', reason: 'logout' }]);
    expect(getSessionPresence()).toBe('absent');
    expect(peekRememberedNext()).toBeNull();
  });

  it('does not wait more than five seconds for the network', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answer({ kind: 'hang' });

    const done = logout();
    await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS - 1);
    expect(endLocalCalls()).toEqual([]);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.hasSignal).toBe(true);
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(LOGOUT_TIMEOUT_MS).toBe(5_000);
    expect(init?.signal?.aborted).toBe(true);
    expect(endLocalCalls()).toEqual([{ op: 'endLocal', reason: 'logout' }]);
  });

  it('ends the session when the request fails', async () => {
    answer((index) => (index === 0 ? apiError(500, 'internal') : { kind: 'network_error' }));

    await logout();
    await logout();

    expect(stub.requests).toHaveLength(2);
    expect(endLocalCalls()).toEqual([
      { op: 'endLocal', reason: 'logout' },
      { op: 'endLocal', reason: 'logout' },
    ]);
    expect(getSessionPresence()).toBe('absent');
  });

  it('sends no push token', async () => {
    answer({ kind: 'empty', status: 204 });
    await logout();
    expect(stub.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['POST', '/v1/auth/logout', {}],
    ]);
  });
});
