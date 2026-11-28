import { describe, expect, it } from 'vitest';

import { emailCodeReducer, INITIAL_EMAIL_CODE_STATE } from './email-code.machine';
import type { EmailCodeState } from './email-code.machine';
import { INITIAL_SIGN_IN_STATE, isSigningUp, signInReducer } from './sign-in.machine';
import type { PendingCredential, SignInEvent, SignInMachineState } from './sign-in.machine';
import type { SignInStage } from './sign-in.types';

const EMAIL_PENDING: PendingCredential = {
  kind: 'email',
  pendingToken: 'p'.repeat(43),
  code: '123456',
};
const GOOGLE_PENDING: PendingCredential = {
  kind: 'google',
  idToken: 'fixture-id-token',
  nonce: 'n'.repeat(43),
};
const NONE = { method: 'none', sourceTier: null } as const;
const STORE = { method: 'store_signal', sourceTier: 'declared' } as const;
const DROPPED = { pending: null, age: null, aiScreening: null, state: null };

const START_RESULT = {
  pendingToken: 'p'.repeat(43),
  expiresAt: '2027-01-15T12:10:00.000Z',
  resendAvailableAt: '2027-01-15T12:00:30.000Z',
};
const CODE_STAGE: EmailCodeState = emailCodeReducer(INITIAL_EMAIL_CODE_STATE, {
  type: 'emailSent',
  sentTo: 'fixture@example.test',
  result: START_RESULT,
});

function at(stage: SignInStage, overrides: Partial<SignInMachineState> = {}): SignInMachineState {
  return { ...INITIAL_SIGN_IN_STATE, stage, ...overrides };
}

function run(state: SignInMachineState, ...events: SignInEvent[]): SignInMachineState {
  return events.reduce(signInReducer, state);
}

/** A sign-up waiting on the final request, with every answer given. */
function finishing(pending: PendingCredential = EMAIL_PENDING): SignInMachineState {
  return at('finishing', {
    pending,
    age: NONE,
    aiScreening: true,
    emailCode: CODE_STAGE,
  });
}

describe('signInReducer', () => {
  it('opens on the methods with nothing pending', () => {
    expect(INITIAL_SIGN_IN_STATE).toMatchObject({
      stage: 'methods',
      pending: null,
      notice: null,
      blocked: null,
      providersBusy: false,
    });
  });

  it('choosing email opens the email stage and clears the notice', () => {
    const state = run(
      at('methods', {
        notice: { code: 'unavailable', retryAfterSeconds: null },
        emailCode: CODE_STAGE,
      }),
      { type: 'chooseEmail' },
    );
    expect(state.stage).toBe('email');
    expect(state.notice).toBeNull();
    expect(state.emailCode).toEqual(INITIAL_EMAIL_CODE_STATE);
  });

  it("a returning person's first answer never asks for the age", () => {
    const sent = run(
      at('email'),
      { type: 'emailCode', event: { type: 'emailSubmitted' } },
      {
        type: 'emailCode',
        event: { type: 'emailSent', sentTo: 'fixture@example.test', result: START_RESULT },
      },
    );
    expect(sent.stage).toBe('code');
    const signedIn = run(
      sent,
      { type: 'emailCode', event: { type: 'codeSubmitted' } },
      { type: 'emailCode', event: { type: 'codeAccepted' } },
      { type: 'signedIn' },
    );
    expect(signedIn.stage).toBe('code');
    expect(isSigningUp(signedIn)).toBe(false);
    expect(signedIn.pending).toBeNull();
  });

  it('the email stage follows the code machine back to the email on a failed resend', () => {
    const state = run(at('code', { emailCode: CODE_STAGE }), {
      type: 'emailCode',
      event: { type: 'resendFailed', code: 'email_undeliverable', retryAfterSeconds: null },
    });
    expect(state.stage).toBe('email');
    expect(state.emailCode.email.errorCode).toBe('email_undeliverable');
  });

  it('signup details are asked only after the server asks', () => {
    const fromCode = run(at('code', { emailCode: CODE_STAGE, providersBusy: true }), {
      type: 'signupRequired',
      pending: EMAIL_PENDING,
    });
    expect(fromCode).toMatchObject({
      stage: 'checkingAge',
      pending: EMAIL_PENDING,
      age: null,
      aiScreening: null,
      state: null,
      notice: null,
      providersBusy: false,
    });
    expect(isSigningUp(fromCode)).toBe(true);
    const fromMethods = run(at('methods'), { type: 'signupRequired', pending: GOOGLE_PENDING });
    expect(fromMethods.stage).toBe('checkingAge');
    expect(fromMethods.pending).toEqual(GOOGLE_PENDING);
  });

  it('a store adult goes to the agreements with its tier', () => {
    const state = run(at('checkingAge', { pending: EMAIL_PENDING }), {
      type: 'storeSignal',
      outcome: { kind: 'adult', tier: 'confirmed' },
    });
    expect(state.stage).toBe('agreements');
    expect(state.age).toEqual({ method: 'store_signal', sourceTier: 'confirmed' });
  });

  it('a store minor stops sign-up', () => {
    const state = run(at('checkingAge', { pending: EMAIL_PENDING }), {
      type: 'storeSignal',
      outcome: { kind: 'minor', tier: 'declared', under13: false },
    });
    expect(state).toMatchObject({ blocked: 'adultsOnly', stage: 'methods', ...DROPPED });
  });

  it('a store minor under 13 stops sign-up the same way', () => {
    const state = run(at('checkingAge', { pending: EMAIL_PENDING }), {
      type: 'storeSignal',
      outcome: { kind: 'minor', tier: 'confirmed', under13: true },
    });
    expect(state).toMatchObject({ blocked: 'adultsOnly', stage: 'methods', ...DROPPED });
  });

  it('with no store signal sign-up goes on to the agreements and asks no age', () => {
    const unavailable = run(at('checkingAge', { pending: EMAIL_PENDING }), {
      type: 'storeSignal',
      outcome: { kind: 'unavailable' },
    });
    const unsupported = run(at('checkingAge', { pending: EMAIL_PENDING }), {
      type: 'storeSignalUnsupported',
    });
    for (const state of [unavailable, unsupported]) {
      expect(state.stage).toBe('agreements');
      expect(state.age).toEqual(NONE);
      expect(state.pending).toEqual(EMAIL_PENDING);
      expect(state.blocked).toBeNull();
    }
  });

  it('agreeing moves on to the AI-screening choice', () => {
    expect(run(at('agreements', { age: STORE }), { type: 'agreed' }).stage).toBe('aiConsent');
  });

  it('"Allow" records true for the AI-screening answer', () => {
    const state = run(at('aiConsent', { age: STORE }), { type: 'aiAnswered', allow: true });
    expect(state.stage).toBe('finishing');
    expect(state.aiScreening).toBe(true);
  });

  it('"Not now" sends no AI answer', () => {
    const state = run(at('aiConsent', { age: STORE }), { type: 'aiAnswered', allow: false });
    expect(state.stage).toBe('finishing');
    expect(state.aiScreening).toBeNull();
  });

  it('the state picker shows only after the server asks', () => {
    const asked = run(finishing(), { type: 'stateRequired' });
    expect(asked.stage).toBe('state');
    const picked = run(asked, { type: 'statePicked', code: 'VT' });
    expect(picked.stage).toBe('finishing');
    expect(picked.state).toBe('VT');
    expect(run(at('aiConsent'), { type: 'stateRequired' }).stage).toBe('aiConsent');
    expect(run(at('finishing'), { type: 'statePicked', code: 'VT' }).state).toBeNull();
  });

  it('an expired code during sign-up returns to the code', () => {
    const state = run(finishing(), {
      type: 'finishRefused',
      code: 'code_expired',
      retryAfterSeconds: null,
    });
    expect(state).toMatchObject({ stage: 'code', ...DROPPED });
    expect(state.emailCode.code.status).toBe('expired');
    expect(state.emailCode.challenge).not.toBeNull();
  });

  it('an expired provider credential returns to the methods with the notice', () => {
    const state = run(finishing(GOOGLE_PENDING), {
      type: 'finishRefused',
      code: 'code_expired',
      retryAfterSeconds: null,
    });
    expect(state.stage).toBe('methods');
    expect(state.notice).toEqual({ code: 'code_expired', retryAfterSeconds: null });
  });

  it('a withheld state blocks with its code', () => {
    const state = run(
      { ...finishing(), state: 'VT' },
      { type: 'finishRefused', code: 'unavailable_in_state', retryAfterSeconds: null },
    );
    expect(state).toMatchObject({
      blocked: { stateUnavailable: 'VT' },
      stage: 'methods',
      ...DROPPED,
    });
  });

  it('a store-signal requirement shows the notice on the methods', () => {
    const state = run(finishing(), {
      type: 'finishRefused',
      code: 'age_signal_required',
      retryAfterSeconds: null,
    });
    expect(state).toMatchObject({
      stage: 'methods',
      notice: { code: 'age_signal_required', retryAfterSeconds: null },
      ...DROPPED,
    });
  });

  it('any other refusal returns to the methods with its code and wait', () => {
    const fromFinishing = run(finishing(), {
      type: 'finishRefused',
      code: 'rate_limited',
      retryAfterSeconds: 60,
    });
    expect(fromFinishing).toMatchObject({
      stage: 'methods',
      notice: { code: 'rate_limited', retryAfterSeconds: 60 },
      ...DROPPED,
    });
    expect(fromFinishing.emailCode).toEqual(INITIAL_EMAIL_CODE_STATE);
    const fromCode = run(at('code', { emailCode: CODE_STAGE }), {
      type: 'finishRefused',
      code: 'account_deleting',
      retryAfterSeconds: null,
    });
    expect(fromCode.stage).toBe('methods');
    expect(fromCode.notice).toEqual({ code: 'account_deleting', retryAfterSeconds: null });
    expect(fromCode.emailCode).toEqual(INITIAL_EMAIL_CODE_STATE);
  });

  it('a session ends the pending sign-up and the busy state', () => {
    const state = run(finishing(), { type: 'signedIn' });
    expect(state.stage).toBe('finishing');
    expect(state.pending).toBeNull();
    expect(state.providersBusy).toBe(false);
  });

  it('a provider flow marks the methods busy and clears the notice', () => {
    const state = run(at('methods', { notice: { code: 'unavailable', retryAfterSeconds: null } }), {
      type: 'providerStarted',
    });
    expect(state.providersBusy).toBe(true);
    expect(state.notice).toBeNull();
  });

  it('the end of a provider flow ends the busy state', () => {
    expect(
      run(at('methods', { providersBusy: true }), { type: 'providerEnded' }).providersBusy,
    ).toBe(false);
  });

  it('a provider refusal shows its notice on the methods', () => {
    const state = run(at('email', { providersBusy: true }), {
      type: 'providerNotice',
      code: 'provider_unavailable',
      retryAfterSeconds: null,
    });
    expect(state).toMatchObject({
      stage: 'methods',
      notice: { code: 'provider_unavailable', retryAfterSeconds: null },
      providersBusy: false,
    });
  });

  it('back from the email returns to the methods', () => {
    expect(run(at('email'), { type: 'back' }).stage).toBe('methods');
  });

  it('back from the code returns to the email and forgets the challenge', () => {
    const state = run(at('code', { emailCode: CODE_STAGE }), { type: 'back' });
    expect(state.stage).toBe('email');
    expect(state.emailCode).toEqual(INITIAL_EMAIL_CODE_STATE);
  });

  it('back from the agreements drops the pending sign-in', () => {
    for (const age of [NONE, STORE]) {
      const state = run(at('agreements', { pending: EMAIL_PENDING, age }), { type: 'back' });
      expect(state).toMatchObject({ stage: 'methods', ...DROPPED });
    }
  });

  it('back from the AI-screening choice returns to the agreements', () => {
    expect(run(at('aiConsent', { age: NONE }), { type: 'back' }).stage).toBe('agreements');
  });

  it('back from the state picker returns to the AI-screening choice', () => {
    expect(run(at('state', { age: NONE }), { type: 'back' }).stage).toBe('aiConsent');
  });

  it('back does nothing on the methods, while waiting or while blocked', () => {
    for (const state of [
      at('methods'),
      at('checkingAge', { pending: EMAIL_PENDING }),
      finishing(),
      at('methods', { blocked: 'adultsOnly' }),
    ]) {
      expect(run(state, { type: 'back' })).toBe(state);
    }
  });

  it('clearing a state block returns to the methods', () => {
    const state = run(at('methods', { blocked: { stateUnavailable: 'VT' } }), {
      type: 'clearBlock',
    });
    expect(state.blocked).toBeNull();
    expect(state.stage).toBe('methods');
  });

  it('ignores events that do not belong to the stage', () => {
    const cases: [SignInMachineState, SignInEvent][] = [
      [at('email'), { type: 'chooseEmail' }],
      [at('methods'), { type: 'emailCode', event: { type: 'emailSubmitted' } }],
      [at('agreements'), { type: 'signupRequired', pending: EMAIL_PENDING }],
      [
        at('agreements'),
        { type: 'storeSignal', outcome: { kind: 'minor', tier: 'declared', under13: false } },
      ],
      [at('methods'), { type: 'storeSignalUnsupported' }],
      [at('agreements'), { type: 'storeSignalUnsupported' }],
      [at('aiConsent'), { type: 'agreed' }],
      [at('agreements'), { type: 'aiAnswered', allow: true }],
      [at('email'), { type: 'finishRefused', code: 'unavailable', retryAfterSeconds: null }],
      [at('email'), { type: 'providerStarted' }],
    ];
    for (const [state, event] of cases) {
      expect(signInReducer(state, event)).toBe(state);
    }
  });
});
