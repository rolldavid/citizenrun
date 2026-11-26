import { LEGAL_VERSIONS, STATE_CODES } from '@citizenrun/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render as renderView, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMeFromCache } from '@/features/system';
import { markNavigationReady, peekRememberedNext, resetNavigationState } from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence } from '@/lib/session-state';
import { fixtureMe, fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import type { ProviderButtonAppearance } from '@/platform/auth';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, RecordedRequest, StubReply } from '@/test/api-stub';
import { ageAssuranceFake } from '@/test/platform/age-assurance';
import { authFake } from '@/test/platform/auth';
import { queryClientFake } from '@/test/platform/query-client';
import { sessionFake } from '@/test/platform/session';
import { storageFake } from '@/test/platform/storage';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import type { SignInViewModel } from './sign-in.types';
import { useSignInViewModel } from './use-sign-in-view-model';

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

const EMAIL = 'fixture@example.test';
const CODE = '123456';
const PENDING = 'p'.repeat(43);
const START = {
  pendingToken: PENDING,
  expiresAt: '2027-01-15T12:10:00.000Z',
  resendAvailableAt: '2020-01-01T00:00:00.000Z',
};
const AGREEMENTS = {
  termsVersion: LEGAL_VERSIONS.terms,
  contentPolicyVersion: LEGAL_VERSIONS.content_policy,
  privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
};
const RETURNING = fixtureSessionInfo({ created: false });
const CREATED = fixtureSessionInfo({
  created: true,
  me: fixtureMe({ onboardingStep: 'photo', onboardedAt: null }),
});

let stub: ApiStub;

type Reply = StubReply | ((index: number) => StubReply);

function answers(options: { start?: Reply; verify?: Reply; google?: Reply }): void {
  const pick = (reply: Reply, index: number): StubReply =>
    typeof reply === 'function' ? reply(index) : reply;
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
    {
      method: 'POST',
      path: '/v1/auth/email/start',
      reply: (_request, index) => pick(options.start ?? json(200, START), index),
    },
    {
      method: 'POST',
      path: '/v1/auth/email/verify',
      reply: (_request, index) => pick(options.verify ?? json(200, RETURNING), index),
    },
    {
      method: 'POST',
      path: '/v1/auth/google',
      reply: (_request, index) => pick(options.google ?? json(200, RETURNING), index),
    },
  ]);
}

/** The verify answers of a new person: details asked, then each later answer in turn. */
function newPerson(...later: StubReply[]): Reply {
  return (index) =>
    index === 0
      ? apiError(422, 'signup_details_required')
      : (later[index - 1] ?? json(200, CREATED));
}

function requests(path: string): RecordedRequest[] {
  return stub.requests.filter((request) => request.path === path);
}

function verifyBodies(): unknown[] {
  return requests('/v1/auth/email/verify').map((request) => request.body);
}

type Hook = ReturnType<typeof renderHookWithClient<ReturnType<typeof useSignInViewModel>, unknown>>;

function render(next: string | null = null): Hook {
  return renderHookWithClient(() => useSignInViewModel({ next }));
}

/** From the methods to a submitted code. */
async function submitCode(hook: Hook): Promise<void> {
  act(() => {
    hook.result.current.onChooseEmail();
  });
  act(() => {
    hook.result.current.email.onSubmit(` ${EMAIL.toUpperCase()} `);
  });
  await waitFor(() => {
    expect(hook.result.current.stage).toBe('code');
  });
  act(() => {
    hook.result.current.code?.onSubmit(CODE);
  });
}

async function reachStage(hook: Hook, stage: string): Promise<void> {
  await waitFor(() => {
    expect(hook.result.current.stage).toBe(stage);
  });
}

/** From the agreements through "Allow" or "Not now". */
function agreeAndAnswer(hook: Hook, allow: boolean): void {
  act(() => {
    hook.result.current.agreements?.onAgree();
  });
  expect(hook.result.current.stage).toBe('aiConsent');
  act(() => {
    hook.result.current.aiConsent?.onAnswer(allow);
  });
}

const APPEARANCE: ProviderButtonAppearance = {
  appleStyle: 'black',
  googleTheme: 'outline',
  googleShape: 'rectangular',
  googleSize: 'large',
  width: 320,
  height: 44,
};

/** The view-model with its two provider buttons drawn, as the screen draws them. */
function renderWithButtons(): { vm: () => SignInViewModel } {
  let latest: SignInViewModel | null = null;
  function Screen(): JSX.Element {
    const vm = useSignInViewModel({ next: null });
    latest = vm;
    const Apple = vm.appleButton;
    const Google = vm.googleButton;
    return (
      <>
        {Apple === null ? null : (
          <Apple appearance={APPEARANCE} testID="apple" accessibilityLabel="Apple" />
        )}
        {Google === null ? null : (
          <Google appearance={APPEARANCE} testID="google" accessibilityLabel="Google" />
        )}
      </>
    );
  }
  renderView(
    <QueryClientProvider client={queryClient.get()}>
      <Screen />
    </QueryClientProvider>,
  );
  return {
    vm: () => {
      if (latest === null) throw new Error('the screen never rendered');
      return latest;
    },
  };
}

beforeEach(() => {
  stub = installApiStub([]);
  answers({});
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

describe('useSignInViewModel', () => {
  it('signs a returning person in without asking their age', async () => {
    const hook = render();
    expect(hook.result.current).toMatchObject({ stage: 'methods', signingUp: false, code: null });
    // The two documents the first stage names, as addresses of the public pages.
    expect(hook.result.current.legalLinks).toEqual({
      terms: 'http://api.test/terms',
      privacyPolicy: 'http://api.test/privacy',
    });
    await submitCode(hook);
    await waitFor(() => {
      expect(getSessionPresence()).toBe('present');
    });

    expect(requests('/v1/auth/email/start').map((request) => request.body)).toEqual([
      { email: EMAIL },
    ]);
    expect(verifyBodies()).toEqual([{ pendingToken: PENDING, code: CODE, intent: 'sign_in' }]);
    expect(ageAssuranceFake.calls).toEqual([]);
    expect(sessionFake.calls).toEqual([{ op: 'adopt', hasToken: true }]);
    expect(readMeFromCache(hook.client)).toEqual(RETURNING.me);
    expect(peekRememberedNext()).toBeNull();
    expect(hook.result.current.signingUp).toBe(false);
  });

  it('signs a new person up with the store adult signal', async () => {
    answers({ verify: newPerson() });
    ageAssuranceFake.scriptSignal({ kind: 'adult', tier: 'declared' });
    const hook = render('/settings');
    await submitCode(hook);
    await reachStage(hook, 'agreements');
    expect(hook.result.current.signingUp).toBe(true);
    expect(hook.result.current.agreements?.links).toEqual({
      terms: 'http://api.test/terms',
      contentPolicy: 'http://api.test/content-policy',
      privacyPolicy: 'http://api.test/privacy',
    });

    agreeAndAnswer(hook, true);
    expect(hook.result.current.stage).toBe('finishing');
    await waitFor(() => {
      expect(getSessionPresence()).toBe('present');
    });

    expect(verifyBodies()).toEqual([
      { pendingToken: PENDING, code: CODE, intent: 'sign_in' },
      {
        pendingToken: PENDING,
        code: CODE,
        intent: 'sign_in',
        signup: {
          age: { method: 'store_signal', sourceTier: 'declared' },
          agreements: AGREEMENTS,
          aiScreening: true,
        },
      },
    ]);
    expect(ageAssuranceFake.calls).toEqual([{ op: 'requestStoreSignal' }]);
    expect(peekRememberedNext()).toBe('/settings');
    expect(readMeFromCache(hook.client)).toEqual(CREATED.me);
  });

  it('uses the date of birth where there is no store signal', async () => {
    answers({ verify: newPerson() });
    ageAssuranceFake.setStoreSignalSupported(false);
    const hook = render();
    await submitCode(hook);
    await reachStage(hook, 'ageGate');
    expect(hook.result.current.ageGate?.thisYear).toBe(new Date().getUTCFullYear());

    act(() => {
      hook.result.current.ageGate?.onSubmit({ year: 1990, month: 4 });
    });
    expect(hook.result.current.stage).toBe('agreements');
    agreeAndAnswer(hook, true);
    await waitFor(() => {
      expect(verifyBodies()).toHaveLength(2);
    });

    expect(verifyBodies()[1]).toMatchObject({
      signup: { age: { method: 'self_declared', sourceTier: 'self' } },
    });
    expect(ageAssuranceFake.calls).toEqual([]);
  });

  it('stops a minor store signal with no account', async () => {
    answers({ verify: newPerson() });
    ageAssuranceFake.scriptSignal({ kind: 'minor', tier: 'confirmed', under13: false });
    const hook = render();
    await submitCode(hook);
    await waitFor(() => {
      expect(hook.result.current.blocked).toBe('adultsOnly');
    });

    expect(verifyBodies()).toHaveLength(1);
    expect(hook.result.current.stage).toBe('methods');
    expect(sessionFake.calls).toEqual([]);
    expect(getSessionPresence()).not.toBe('present');
  });

  it('locks the gate after a minor birth month and asks nothing again', async () => {
    answers({ verify: newPerson() });
    ageAssuranceFake.setStoreSignalSupported(false);
    const first = render();
    await submitCode(first);
    await reachStage(first, 'ageGate');
    act(() => {
      first.result.current.ageGate?.onSubmit({ year: new Date().getUTCFullYear() - 10, month: 1 });
    });
    expect(first.result.current.blocked).toBe('adultsOnly');
    expect(ageAssuranceFake.calls).toEqual([{ op: 'blockGate' }]);
    expect(storageFake.calls).toEqual([{ op: 'set', key: 'ageGate.blockedUntil' }]);
    first.unmount();

    ageAssuranceFake.setStoreSignalSupported(true);
    answers({ verify: newPerson() });
    const second = render();
    await submitCode(second);
    await waitFor(() => {
      expect(second.result.current.blocked).toBe('adultsOnly');
    });
    expect(ageAssuranceFake.calls).toEqual([{ op: 'blockGate' }]);
    expect(
      verifyBodies().filter(
        (body) => body !== null && typeof body === 'object' && 'signup' in body,
      ),
    ).toEqual([]);
  });

  it('leaves the adults-only screen for the welcome screen', async () => {
    answers({ verify: newPerson() });
    ageAssuranceFake.scriptSignal({ kind: 'minor', tier: 'declared', under13: true });
    const hook = render('/settings');
    await submitCode(hook);
    await waitFor(() => {
      expect(hook.result.current.blocked).toBe('adultsOnly');
    });
    act(() => {
      hook.result.current.onBack();
    });
    expect(routerCalls).toEqual([{ op: 'replace', path: '/welcome' }]);
  });

  it('sends no AI answer for "Not now"', async () => {
    answers({ verify: newPerson() });
    const hook = render();
    await submitCode(hook);
    await reachStage(hook, 'agreements');
    agreeAndAnswer(hook, false);
    await waitFor(() => {
      expect(verifyBodies()).toHaveLength(2);
    });
    expect(verifyBodies()[1]).toMatchObject({ signup: { aiScreening: null } });
  });

  it('asks for the state only when the server says so', async () => {
    answers({
      verify: newPerson(
        apiError(400, 'invalid_request', { fields: { 'signup.state': 'required' } }),
      ),
    });
    const hook = render();
    await submitCode(hook);
    await reachStage(hook, 'agreements');
    expect(hook.result.current.statePicker).toBeNull();
    agreeAndAnswer(hook, true);
    await reachStage(hook, 'state');
    expect(hook.result.current.statePicker?.codes).toEqual(STATE_CODES);

    act(() => {
      hook.result.current.statePicker?.onSubmit('VT');
    });
    expect(hook.result.current.stage).toBe('finishing');
    await waitFor(() => {
      expect(getSessionPresence()).toBe('present');
    });
    expect(verifyBodies()).toHaveLength(3);
    expect(verifyBodies()[1]).not.toHaveProperty('signup.state');
    expect(verifyBodies()[2]).toMatchObject({
      pendingToken: PENDING,
      code: CODE,
      signup: { state: 'VT', aiScreening: true },
    });
  });

  it('shows the state screen for a withheld state', async () => {
    answers({
      verify: newPerson(
        apiError(400, 'invalid_request', { fields: { 'signup.state': 'required' } }),
        apiError(403, 'unavailable_in_state'),
      ),
    });
    const hook = render();
    await submitCode(hook);
    await reachStage(hook, 'agreements');
    agreeAndAnswer(hook, true);
    await reachStage(hook, 'state');
    act(() => {
      hook.result.current.statePicker?.onSubmit('VT');
    });
    await waitFor(() => {
      expect(hook.result.current.blocked).toEqual({ stateUnavailable: 'VT' });
    });

    act(() => {
      hook.result.current.onBack();
    });
    expect(hook.result.current.blocked).toBeNull();
    expect(hook.result.current.stage).toBe('methods');
    expect(routerCalls).toEqual([]);
  });

  it('shows the store-signal notice on the methods', async () => {
    answers({ verify: newPerson(apiError(422, 'age_signal_required')) });
    ageAssuranceFake.setStoreSignalSupported(false);
    const hook = render();
    await submitCode(hook);
    await reachStage(hook, 'ageGate');
    act(() => {
      hook.result.current.ageGate?.onSubmit({ year: 1990, month: 4 });
    });
    agreeAndAnswer(hook, true);
    await reachStage(hook, 'methods');
    expect(hook.result.current.notice).toEqual({
      code: 'age_signal_required',
      retryAfterSeconds: null,
    });
  });

  it('returns to the code when it expired during sign-up', async () => {
    answers({ verify: newPerson(apiError(422, 'code_expired')) });
    const hook = render();
    await submitCode(hook);
    await reachStage(hook, 'agreements');
    agreeAndAnswer(hook, true);
    await reachStage(hook, 'code');
    expect(hook.result.current.code?.status).toBe('expired');
    expect(hook.result.current.signingUp).toBe(false);
  });

  it('marks a wrong code', async () => {
    answers({ verify: apiError(422, 'code_invalid') });
    const hook = render();
    await submitCode(hook);
    await waitFor(() => {
      expect(hook.result.current.code?.status).toBe('wrong');
    });
  });

  it('shows the resend wait', async () => {
    answers({
      start: (index) =>
        index === 0 ? json(200, START) : apiError(429, 'rate_limited', { retryAfterSeconds: 900 }),
    });
    const hook = render();
    act(() => {
      hook.result.current.onChooseEmail();
    });
    act(() => {
      hook.result.current.email.onSubmit(EMAIL);
    });
    await reachStage(hook, 'code');
    act(() => {
      hook.result.current.code?.onResend();
    });
    await waitFor(() => {
      expect(hook.result.current.code?.resendStatus).toBe('limited');
    });
    expect(hook.result.current.code?.resendRetryAfterSeconds).toBe(900);
    expect(requests('/v1/auth/email/start').map((request) => request.body)).toEqual([
      { email: EMAIL },
      { email: EMAIL, pendingToken: PENDING },
    ]);
  });

  it('sends one request for two presses of Resend in one tick', async () => {
    const hook = render();
    act(() => {
      hook.result.current.onChooseEmail();
    });
    act(() => {
      hook.result.current.email.onSubmit(EMAIL);
    });
    await reachStage(hook, 'code');
    act(() => {
      hook.result.current.code?.onResend();
      hook.result.current.code?.onResend();
    });
    await waitFor(() => {
      expect(hook.result.current.code?.resendStatus).toBe('idle');
    });
    expect(requests('/v1/auth/email/start')).toHaveLength(2);

    act(() => {
      hook.result.current.code?.onResend();
    });
    await waitFor(() => {
      expect(requests('/v1/auth/email/start')).toHaveLength(3);
    });
  });

  it('waits for the resend time before sending again', async () => {
    answers({ start: json(200, { ...START, resendAvailableAt: '2999-01-01T00:00:00.000Z' }) });
    const hook = render();
    act(() => {
      hook.result.current.onChooseEmail();
    });
    act(() => {
      hook.result.current.email.onSubmit(EMAIL);
    });
    await reachStage(hook, 'code');
    act(() => {
      hook.result.current.code?.onResend();
    });
    expect(requests('/v1/auth/email/start')).toHaveLength(1);
  });

  it('refuses a malformed address without a request', () => {
    const hook = render();
    act(() => {
      hook.result.current.onChooseEmail();
    });
    act(() => {
      hook.result.current.email.onSubmit('not an email');
    });
    expect(hook.result.current.email).toMatchObject({
      status: 'idle',
      errorCode: 'invalid_request',
    });
    expect(requests('/v1/auth/email/start')).toEqual([]);
  });

  it('does nothing while offline', () => {
    queryClientFake.setOnline(false);
    const hook = render();
    expect(hook.result.current.offline).toBe(true);
    act(() => {
      hook.result.current.onChooseEmail();
    });
    act(() => {
      hook.result.current.email.onSubmit(EMAIL);
    });
    expect(hook.result.current.email.status).toBe('idle');
    expect(requests('/v1/auth/email/start')).toEqual([]);
  });

  it('leaves for the welcome screen from the methods', () => {
    const hook = render('/settings');
    act(() => {
      hook.result.current.onBack();
    });
    expect(routerCalls).toEqual([{ op: 'replace', path: '/welcome?next=%2Fsettings' }]);
  });

  it('goes back one stage at a time', async () => {
    const hook = render();
    await submitCode(hook);
    await waitFor(() => {
      expect(getSessionPresence()).toBe('present');
    });
    act(() => {
      hook.result.current.onBack();
    });
    expect(hook.result.current.stage).toBe('email');
    act(() => {
      hook.result.current.onBack();
    });
    expect(hook.result.current.stage).toBe('methods');
  });

  it('shows a refused provider sign-in as a notice', async () => {
    const screen = renderWithButtons();
    await waitFor(() => {
      expect(authFake.calls).toContainEqual({
        op: 'mount',
        provider: 'apple',
        nonceHash: 'fixture-hash',
        state: 's'.repeat(43),
      });
    });
    act(() => {
      authFake.emitApple({ kind: 'server_refused', reason: 'token_invalid' });
    });
    expect(screen.vm()).toMatchObject({
      stage: 'methods',
      providersBusy: false,
      notice: { code: 'identity_token_invalid', retryAfterSeconds: null },
    });
  });

  it('repeats a provider sign-in with the sign-up details', async () => {
    answers({ google: newPerson() });
    const screen = renderWithButtons();
    await waitFor(() => {
      expect(authFake.calls).toContainEqual({
        op: 'mount',
        provider: 'google',
        nonceHash: 'fixture-hash',
      });
    });
    act(() => {
      authFake.emitGoogle({ kind: 'token', idToken: 'fixture-id-token' });
    });
    expect(screen.vm().providersBusy).toBe(true);
    await waitFor(() => {
      expect(screen.vm().stage).toBe('agreements');
    });
    expect(screen.vm().providersBusy).toBe(false);
    act(() => {
      screen.vm().agreements?.onAgree();
    });
    act(() => {
      screen.vm().aiConsent?.onAnswer(true);
    });
    await waitFor(() => {
      expect(getSessionPresence()).toBe('present');
    });

    expect(requests('/v1/auth/google').map((request) => request.body)).toEqual([
      { idToken: 'fixture-id-token', nonce: 'n'.repeat(43), intent: 'sign_in' },
      {
        idToken: 'fixture-id-token',
        nonce: 'n'.repeat(43),
        intent: 'sign_in',
        signup: {
          age: { method: 'store_signal', sourceTier: 'declared' },
          agreements: AGREEMENTS,
          aiScreening: true,
        },
      },
    ]);
  });

  it('keeps typed values out of URLs and the device', async () => {
    answers({ verify: newPerson() });
    ageAssuranceFake.setStoreSignalSupported(false);
    const hook = render('/settings');
    await submitCode(hook);
    await reachStage(hook, 'ageGate');
    act(() => {
      hook.result.current.ageGate?.onSubmit({ year: 1990, month: 4 });
    });
    agreeAndAnswer(hook, true);
    await waitFor(() => {
      expect(getSessionPresence()).toBe('present');
    });

    const fixedPaths = new Set(['/v1/auth/nonce', '/v1/auth/email/start', '/v1/auth/email/verify']);
    for (const request of stub.requests) {
      expect(fixedPaths.has(request.path)).toBe(true);
      expect(request.query).toEqual({});
    }
    expect(storageFake.calls.filter((call) => call.op === 'set')).toEqual([]);
    expect(sessionFake.calls).toEqual([{ op: 'adopt', hasToken: true }]);
    const records = JSON.stringify([
      sessionFake.calls,
      storageFake.calls,
      authFake.calls,
      ageAssuranceFake.calls,
      routerCalls,
    ]);
    for (const typed of [EMAIL, CODE, PENDING, '1990', RETURNING.token ?? '']) {
      expect(records.includes(typed)).toBe(false);
    }
  });
});
