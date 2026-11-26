import { describe, expect, it } from 'vitest';

import { emailCodeReducer, INITIAL_EMAIL_CODE_STATE } from './email-code.machine';
import type { EmailCodeState } from './email-code.machine';

const RESULT = {
  pendingToken: 'p'.repeat(43),
  expiresAt: '2027-01-15T12:10:00.000Z',
  resendAvailableAt: '2027-01-15T12:00:30.000Z',
};
const NEW_RESULT = {
  pendingToken: 'q'.repeat(43),
  expiresAt: '2027-01-15T12:20:00.000Z',
  resendAvailableAt: '2027-01-15T12:10:30.000Z',
};

function atCode(code: Partial<EmailCodeState['code']> = {}): EmailCodeState {
  const sent = emailCodeReducer(INITIAL_EMAIL_CODE_STATE, {
    type: 'emailSent',
    sentTo: 'fixture@example.test',
    result: RESULT,
  });
  return { ...sent, code: { ...sent.code, ...code } };
}

describe('emailCodeReducer', () => {
  it('starts on the email stage with nothing sent', () => {
    expect(INITIAL_EMAIL_CODE_STATE).toEqual({
      stage: 'email',
      email: { status: 'idle', errorCode: null, retryAfterSeconds: null },
      challenge: null,
      code: { status: 'idle', resendStatus: 'idle', resendRetryAfterSeconds: null },
    });
  });

  it('a submitted address is sending and clears the last error', () => {
    const failed = emailCodeReducer(INITIAL_EMAIL_CODE_STATE, {
      type: 'emailFailed',
      code: 'rate_limited',
      retryAfterSeconds: 60,
    });
    expect(emailCodeReducer(failed, { type: 'emailSubmitted' }).email).toEqual({
      status: 'sending',
      errorCode: null,
      retryAfterSeconds: null,
    });
  });

  it('a sent code opens the code stage with the challenge', () => {
    const sending = emailCodeReducer(INITIAL_EMAIL_CODE_STATE, { type: 'emailSubmitted' });
    const sent = emailCodeReducer(sending, {
      type: 'emailSent',
      sentTo: 'fixture@example.test',
      result: RESULT,
    });
    expect(sent).toEqual({
      stage: 'code',
      email: { status: 'idle', errorCode: null, retryAfterSeconds: null },
      challenge: {
        sentTo: 'fixture@example.test',
        pendingToken: RESULT.pendingToken,
        resendAvailableAt: RESULT.resendAvailableAt,
      },
      code: { status: 'idle', resendStatus: 'idle', resendRetryAfterSeconds: null },
    });
  });

  it('a refused address stays on the email stage with its code and wait', () => {
    const sending = emailCodeReducer(INITIAL_EMAIL_CODE_STATE, { type: 'emailSubmitted' });
    const failed = emailCodeReducer(sending, {
      type: 'emailFailed',
      code: 'rate_limited',
      retryAfterSeconds: 120,
    });
    expect(failed.stage).toBe('email');
    expect(failed.email).toEqual({
      status: 'idle',
      errorCode: 'rate_limited',
      retryAfterSeconds: 120,
    });
  });

  it('a submitted code is being checked', () => {
    expect(emailCodeReducer(atCode(), { type: 'codeSubmitted' }).code.status).toBe('checking');
  });

  it('a wrong code marks the field wrong', () => {
    const state = emailCodeReducer(atCode({ status: 'checking' }), {
      type: 'codeRefused',
      code: 'code_invalid',
    });
    expect(state.code.status).toBe('wrong');
    expect(state.stage).toBe('code');
  });

  it('five wrong codes lock the field', () => {
    const state = emailCodeReducer(atCode({ status: 'checking' }), {
      type: 'codeRefused',
      code: 'code_attempts_exhausted',
    });
    expect(state.code.status).toBe('locked');
  });

  it('an expired code asks for a new one', () => {
    const state = emailCodeReducer(atCode({ status: 'checking' }), {
      type: 'codeRefused',
      code: 'code_expired',
    });
    expect(state.code.status).toBe('expired');
  });

  it('any other refusal of a code leaves the field idle for the caller', () => {
    const state = emailCodeReducer(atCode({ status: 'checking' }), {
      type: 'codeRefused',
      code: 'unavailable',
    });
    expect(state.code.status).toBe('idle');
    expect(state.challenge).not.toBeNull();
  });

  it('an accepted code leaves the field idle', () => {
    expect(
      emailCodeReducer(atCode({ status: 'checking' }), { type: 'codeAccepted' }).code.status,
    ).toBe('idle');
  });

  it('a resend is sending', () => {
    expect(emailCodeReducer(atCode(), { type: 'resendSubmitted' }).code.resendStatus).toBe(
      'sending',
    );
  });

  it('a new code replaces the challenge and clears a locked field', () => {
    const state = emailCodeReducer(
      atCode({ status: 'locked', resendStatus: 'sending', resendRetryAfterSeconds: 30 }),
      { type: 'resent', result: NEW_RESULT },
    );
    expect(state.challenge).toEqual({
      sentTo: 'fixture@example.test',
      pendingToken: NEW_RESULT.pendingToken,
      resendAvailableAt: NEW_RESULT.resendAvailableAt,
    });
    expect(state.code).toEqual({
      status: 'idle',
      resendStatus: 'idle',
      resendRetryAfterSeconds: null,
    });
  });

  it('a limited resend shows the wait', () => {
    const state = emailCodeReducer(atCode({ resendStatus: 'sending' }), {
      type: 'resendFailed',
      code: 'rate_limited',
      retryAfterSeconds: 900,
    });
    expect(state.stage).toBe('code');
    expect(state.code).toMatchObject({ resendStatus: 'limited', resendRetryAfterSeconds: 900 });
    expect(state.challenge).not.toBeNull();
  });

  it('any other resend refusal returns to the email stage with its code', () => {
    const state = emailCodeReducer(atCode({ resendStatus: 'sending', status: 'wrong' }), {
      type: 'resendFailed',
      code: 'email_signin_paused',
      retryAfterSeconds: null,
    });
    expect(state).toEqual({
      stage: 'email',
      email: { status: 'idle', errorCode: 'email_signin_paused', retryAfterSeconds: null },
      challenge: null,
      code: { status: 'idle', resendStatus: 'idle', resendRetryAfterSeconds: null },
    });
  });

  it('changing the email forgets the challenge', () => {
    expect(emailCodeReducer(atCode({ status: 'wrong' }), { type: 'changeEmail' })).toEqual(
      INITIAL_EMAIL_CODE_STATE,
    );
  });
});
