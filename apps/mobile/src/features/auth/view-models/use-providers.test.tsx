import type { NonceResult } from '@citizenrun/shared';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import { auth } from '@/platform/auth';
import type {
  AppleSignInButtonProps,
  GoogleSignInButtonProps,
  ProviderButtonAppearance,
} from '@/platform/auth';
import { PlatformNotReadyError } from '@/platform/shared';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply } from '@/test/api-stub';
import { authFake } from '@/test/platform/auth';

import type { SignInIntent } from '../data/sign-in-requests';

import { PROVIDER_BUSY_LIMIT_MS, useProviders } from './use-providers';
import type { ProviderAttempt } from './use-providers';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

const APPEARANCE: ProviderButtonAppearance = {
  appleStyle: 'black',
  googleTheme: 'outline',
  googleShape: 'rectangular',
  googleSize: 'large',
  width: 320,
  height: 44,
};
const T0 = Date.parse('2027-01-15T12:00:00.000Z');

function nonceResult(n: number, expiresAt: string): NonceResult {
  return {
    nonce: String(n).repeat(43),
    nonceHash: `hash-${String(n)}`,
    state: `state-${String(n)}`,
    expiresAt,
  };
}

function inTenMinutes(): string {
  return new Date(Date.now() + 600_000).toISOString();
}

let stub: ApiStub;
let appleSpy: MockInstance<typeof auth.AppleSignInButton>;
let googleSpy: MockInstance<typeof auth.GoogleSignInButton>;
let current: ReturnType<typeof useProviders> | null = null;
const onStart = vi.fn<() => void>();
const onEnded = vi.fn<() => void>();
const onAttempt = vi.fn<(attempt: ProviderAttempt) => void>();

function report(providers: ReturnType<typeof useProviders>): void {
  current = providers;
}

function Harness({ intent }: { intent: SignInIntent }): JSX.Element {
  const providers = useProviders({
    intent,
    enabled: true,
    disabled: false,
    onStart,
    onEnded,
    onAttempt,
  });
  useEffect(() => {
    report(providers);
  });
  const Apple = providers.appleButton;
  const Google = providers.googleButton;
  return (
    <>
      {Apple === null ? null : (
        <Apple appearance={APPEARANCE} testID="apple" accessibilityLabel="Continue with Apple" />
      )}
      {Google === null ? null : (
        <Google appearance={APPEARANCE} testID="google" accessibilityLabel="Continue with Google" />
      )}
    </>
  );
}

function routes(post: StubReply = json(200, fixtureSessionInfo())): void {
  stub.use([
    {
      method: 'POST',
      path: '/v1/auth/nonce',
      reply: (_request, index) => json(200, nonceResult(index + 1, inTenMinutes())),
    },
    { method: 'POST', path: '/v1/auth/apple', reply: post },
    { method: 'POST', path: '/v1/auth/apple/handoff', reply: post },
    { method: 'POST', path: '/v1/auth/google', reply: post },
  ]);
}

function nonceRequests() {
  return stub.requests.filter((request) => request.path === '/v1/auth/nonce');
}

function lastAppleProps(): AppleSignInButtonProps {
  const props = appleSpy.mock.lastCall?.[0];
  if (props === undefined) throw new Error('the Apple button never rendered');
  return props;
}

function lastGoogleProps(): GoogleSignInButtonProps {
  const props = googleSpy.mock.lastCall?.[0];
  if (props === undefined) throw new Error('the Google button never rendered');
  return props;
}

function busy(): boolean {
  return current?.busy ?? false;
}

async function mounted(intent: SignInIntent = 'sign_in'): Promise<ReturnType<typeof render>> {
  const view = render(<Harness intent={intent} />);
  await waitFor(() => {
    expect(lastAppleProps().disabled).toBe(false);
  });
  return view;
}

/** Lets the stubbed requests answer while setTimeout is faked. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    });
  }
}

beforeEach(() => {
  stub = installApiStub([]);
  routes();
  configureTestApiClient();
  appleSpy = vi.spyOn(auth, 'AppleSignInButton');
  googleSpy = vi.spyOn(auth, 'GoogleSignInButton');
  current = null;
  onStart.mockReset();
  onEnded.mockReset();
  onAttempt.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useProviders', () => {
  it('draws no button the build cannot offer', async () => {
    authFake.scriptAvailability({ apple: false, google: true });
    render(<Harness intent="sign_in" />);
    await waitFor(() => {
      expect(current?.googleButton).not.toBeNull();
    });
    expect(current?.appleButton).toBeNull();
  });

  it('draws no button while the module is not ready', async () => {
    const prepare = vi
      .spyOn(auth, 'prepare')
      .mockRejectedValue(new PlatformNotReadyError('auth', 'prepare'));
    render(<Harness intent="sign_in" />);
    await waitFor(() => {
      expect(nonceRequests()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(1);
    });
    await settle();
    expect(current?.appleButton).toBeNull();
    expect(current?.googleButton).toBeNull();
  });

  it('asks for a nonce and binds its hash', async () => {
    await mounted();
    expect(nonceRequests()).toHaveLength(1);
    expect(nonceRequests()[0]?.body).toEqual({});
    expect(authFake.calls).toEqual(
      expect.arrayContaining([
        { op: 'mount', provider: 'apple', nonceHash: 'hash-1', state: 'state-1' },
        { op: 'mount', provider: 'google', nonceHash: 'hash-1' },
      ]),
    );
    expect(lastGoogleProps()).toMatchObject({ nonceHash: 'hash-1', disabled: false });
  });

  it('asks for a new nonce when the old one expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
    const expiries = [new Date(T0 + 60_000).toISOString(), new Date(T0 + 660_000).toISOString()];
    stub.use([
      {
        method: 'POST',
        path: '/v1/auth/nonce',
        reply: (_request, index) =>
          json(200, nonceResult(index + 1, expiries[index] ?? inTenMinutes())),
      },
    ]);
    const view = render(<Harness intent="sign_in" />);
    await settle();
    expect(lastAppleProps().nonceHash).toBe('hash-1');
    const node = view.getByTestId('apple');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(nonceRequests()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();

    expect(nonceRequests()).toHaveLength(2);
    expect(lastAppleProps()).toMatchObject({ nonceHash: 'hash-2', state: 'state-2' });
    // The same mounted button took the new hash: its element was never replaced.
    expect(view.getByTestId('apple')).toBe(node);
    expect(
      authFake.calls.filter((call) => call.op === 'mount' && call.provider === 'apple'),
    ).toEqual([
      { op: 'mount', provider: 'apple', nonceHash: 'hash-1', state: 'state-1' },
      { op: 'mount', provider: 'apple', nonceHash: 'hash-2', state: 'state-2' },
    ]);
  });

  it('posts an Apple token with the raw nonce', async () => {
    await mounted();
    act(() => {
      authFake.emitApple({ kind: 'token', idToken: 'fixture-id-token', code: null, name: null });
    });
    await waitFor(() => {
      expect(onAttempt).toHaveBeenCalledTimes(1);
    });

    const post = stub.requests.find((request) => request.path === '/v1/auth/apple');
    expect(post?.body).toEqual({
      idToken: 'fixture-id-token',
      code: null,
      nonce: '1'.repeat(43),
      intent: 'sign_in',
    });
    expect(post?.body).not.toHaveProperty('name');
    expect(onAttempt).toHaveBeenCalledWith({ kind: 'session', info: fixtureSessionInfo() });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('keeps the pending credential when sign-up details are needed', async () => {
    routes(apiError(422, 'signup_details_required'));
    await mounted();
    act(() => {
      authFake.emitApple({
        kind: 'token',
        idToken: 'fixture-id-token',
        code: 'fixture-code',
        name: { givenName: 'Fixture', familyName: null },
      });
    });
    await waitFor(() => {
      expect(onAttempt).toHaveBeenCalledTimes(1);
    });
    expect(onAttempt).toHaveBeenCalledWith({
      kind: 'signupRequired',
      pending: {
        kind: 'apple',
        idToken: 'fixture-id-token',
        code: 'fixture-code',
        nonce: '1'.repeat(43),
        name: { givenName: 'Fixture', familyName: null },
      },
    });
    const post = stub.requests.find((request) => request.path === '/v1/auth/apple');
    expect(post?.body).toMatchObject({ name: { givenName: 'Fixture', familyName: null } });
  });

  it('posts the Android hand-off at once', async () => {
    await mounted();
    const code = 'h'.repeat(43);
    act(() => {
      authFake.emitApple({ kind: 'handoff', code });
    });
    await waitFor(() => {
      expect(onAttempt).toHaveBeenCalledTimes(1);
    });
    const post = stub.requests.find((request) => request.path === '/v1/auth/apple/handoff');
    expect(post?.body).toEqual({ code, nonce: '1'.repeat(43), intent: 'sign_in' });
  });

  it('shows a refused Apple callback as the contract maps it', async () => {
    await mounted();
    act(() => {
      authFake.emitApple({ kind: 'server_refused', reason: 'state_invalid' });
    });
    expect(onAttempt).toHaveBeenLastCalledWith({
      kind: 'refused',
      code: 'identity_token_invalid',
      retryAfterSeconds: null,
    });
    await waitFor(() => {
      expect(lastAppleProps()).toMatchObject({ nonceHash: 'hash-2', disabled: false });
    });
    act(() => {
      authFake.emitApple({ kind: 'server_refused', reason: 'signup_limit_reached' });
    });
    expect(onAttempt).toHaveBeenLastCalledWith({
      kind: 'refused',
      code: 'signup_limit_reached',
      retryAfterSeconds: null,
    });
    await waitFor(() => {
      expect(lastAppleProps()).toMatchObject({ nonceHash: 'hash-3', disabled: false });
    });
    // signups_closed is not yet an error code of the catalog; it reads as the generic message.
    act(() => {
      authFake.emitApple({ kind: 'server_refused', reason: 'signups_closed' });
    });
    expect(onAttempt).toHaveBeenLastCalledWith({
      kind: 'refused',
      code: 'generic',
      retryAfterSeconds: null,
    });
    expect(stub.requests.filter((request) => request.path === '/v1/auth/apple')).toEqual([]);
  });

  it('maps provider failures', async () => {
    await mounted();
    act(() => {
      authFake.emitApple({ kind: 'failed', code: 'auth.not_configured' });
    });
    expect(onAttempt).toHaveBeenLastCalledWith({
      kind: 'refused',
      code: 'provider_unavailable',
      retryAfterSeconds: null,
    });
    await waitFor(() => {
      expect(lastGoogleProps()).toMatchObject({ nonceHash: 'hash-2', disabled: false });
    });
    act(() => {
      authFake.emitGoogle({ kind: 'failed', code: 'auth.provider_error' });
    });
    expect(onAttempt).toHaveBeenLastCalledWith({
      kind: 'refused',
      code: 'generic',
      retryAfterSeconds: null,
    });
  });

  it('answers a refused post with its code and wait', async () => {
    routes(apiError(429, 'rate_limited', { retryAfterSeconds: 30 }));
    await mounted();
    act(() => {
      authFake.emitGoogle({ kind: 'token', idToken: 'fixture-id-token' });
    });
    await waitFor(() => {
      expect(onAttempt).toHaveBeenCalledWith({
        kind: 'refused',
        code: 'rate_limited',
        retryAfterSeconds: 30,
      });
    });
  });

  it('says nothing when the person cancels', async () => {
    await mounted();
    act(() => {
      authFake.emitGoogle({ kind: 'cancelled' });
    });
    expect(onAttempt).not.toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(busy()).toBe(false);
  });

  it('ends the busy state after thirty seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
    render(<Harness intent="sign_in" />);
    await settle();
    expect(lastAppleProps().disabled).toBe(false);

    act(() => {
      lastAppleProps().onStart();
    });
    expect(busy()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVIDER_BUSY_LIMIT_MS - 1);
    });
    expect(busy()).toBe(true);
    expect(onEnded).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(PROVIDER_BUSY_LIMIT_MS).toBe(30_000);
    expect(busy()).toBe(false);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it('disables the buttons while busy', async () => {
    await mounted();
    act(() => {
      lastGoogleProps().onStart();
    });
    expect(busy()).toBe(true);
    expect(lastAppleProps().disabled).toBe(true);
    expect(lastGoogleProps().disabled).toBe(true);
    // A second press while busy starts nothing.
    act(() => {
      lastAppleProps().onStart();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('asks for a new nonce after every attempt', async () => {
    await mounted();
    expect(nonceRequests()).toHaveLength(1);
    act(() => {
      authFake.emitGoogle({ kind: 'cancelled' });
    });
    expect(lastGoogleProps().disabled).toBe(true);
    await waitFor(() => {
      expect(nonceRequests()).toHaveLength(2);
    });
    await waitFor(() => {
      expect(lastGoogleProps()).toMatchObject({ nonceHash: 'hash-2', disabled: false });
    });
  });

  it('posts with the re-authentication intent', async () => {
    await mounted('reauth');
    act(() => {
      authFake.emitGoogle({ kind: 'token', idToken: 'fixture-id-token' });
    });
    await waitFor(() => {
      expect(onAttempt).toHaveBeenCalledTimes(1);
    });
    const post = stub.requests.find((request) => request.path === '/v1/auth/google');
    expect(post?.body).toEqual({
      idToken: 'fixture-id-token',
      nonce: '1'.repeat(43),
      intent: 'reauth',
    });
  });
});
