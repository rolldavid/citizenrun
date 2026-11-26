import { LEGAL_VERSIONS } from '@citizenrun/shared';
import type { SignupDetails } from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';

import {
  postAppleHandoff,
  postAppleToken,
  postGoogleToken,
  requestEmailCode,
  requestNonce,
  verifyEmailCode,
} from './sign-in-requests';

const PENDING = 'p'.repeat(43);
const NONCE = 'n'.repeat(43);
const START_RESULT = {
  pendingToken: PENDING,
  expiresAt: '2027-01-15T12:10:00.000Z',
  resendAvailableAt: '2027-01-15T12:00:30.000Z',
};
const NONCE_RESULT = {
  nonce: NONCE,
  nonceHash: 'h'.repeat(64),
  state: 's'.repeat(43),
  expiresAt: '2027-01-15T12:10:00.000Z',
};
const SIGNUP: SignupDetails = {
  age: { method: 'self_declared', sourceTier: 'self' },
  agreements: {
    termsVersion: LEGAL_VERSIONS.terms,
    contentPolicyVersion: LEGAL_VERSIONS.content_policy,
    privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
  },
  aiScreening: null,
};

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([
    { method: 'POST', path: '/v1/auth/email/start', reply: json(200, START_RESULT) },
    { method: 'POST', path: '/v1/auth/email/verify', reply: json(200, fixtureSessionInfo()) },
    { method: 'POST', path: '/v1/auth/nonce', reply: json(200, NONCE_RESULT) },
    { method: 'POST', path: '/v1/auth/apple', reply: json(200, fixtureSessionInfo()) },
    { method: 'POST', path: '/v1/auth/apple/handoff', reply: json(200, fixtureSessionInfo()) },
    { method: 'POST', path: '/v1/auth/google', reply: json(200, fixtureSessionInfo()) },
  ]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sent() {
  return stub.requests.map((request) => ({
    method: request.method,
    path: request.path,
    body: request.body,
  }));
}

describe('sign-in requests', () => {
  it('starts an email sign-in', async () => {
    const first = await requestEmailCode({ email: 'fixture@example.test' });
    const again = await requestEmailCode({ email: 'fixture@example.test', pendingToken: PENDING });

    expect(first).toEqual({ ok: true, value: START_RESULT });
    expect(again.ok).toBe(true);
    expect(sent()).toEqual([
      { method: 'POST', path: '/v1/auth/email/start', body: { email: 'fixture@example.test' } },
      {
        method: 'POST',
        path: '/v1/auth/email/start',
        body: { email: 'fixture@example.test', pendingToken: PENDING },
      },
    ]);
  });

  it('verifies a code with no signup details unless given', async () => {
    const plain = await verifyEmailCode({
      pendingToken: PENDING,
      code: '123456',
      intent: 'sign_in',
    });
    await verifyEmailCode({
      pendingToken: PENDING,
      code: '123456',
      intent: 'sign_in',
      signup: SIGNUP,
    });

    expect(plain).toEqual({ ok: true, value: fixtureSessionInfo() });
    const [first, second] = stub.requests;
    expect(first?.body).toEqual({ pendingToken: PENDING, code: '123456', intent: 'sign_in' });
    expect(first?.body).not.toHaveProperty('signup');
    expect(second?.body).toEqual({
      pendingToken: PENDING,
      code: '123456',
      intent: 'sign_in',
      signup: SIGNUP,
    });
    expect(second?.body).not.toHaveProperty('signup.state');
  });

  it('carries a picked state in the signup details', async () => {
    await verifyEmailCode({
      pendingToken: PENDING,
      code: '123456',
      intent: 'sign_in',
      signup: { ...SIGNUP, state: 'VT' },
    });
    expect(stub.requests[0]?.body).toMatchObject({ signup: { state: 'VT' } });
  });

  it('asks for a nonce with an empty body', async () => {
    const outcome = await requestNonce();
    expect(outcome).toEqual({ ok: true, value: NONCE_RESULT });
    expect(sent()).toEqual([{ method: 'POST', path: '/v1/auth/nonce', body: {} }]);
  });

  it('posts an Apple token with the raw nonce and the name only when present', async () => {
    await postAppleToken({
      idToken: 'fixture-id-token',
      code: null,
      nonce: NONCE,
      intent: 'sign_in',
    });
    await postAppleToken({
      idToken: 'fixture-id-token',
      code: 'fixture-code',
      nonce: NONCE,
      intent: 'reauth',
      name: { givenName: 'Fixture', familyName: null },
    });

    expect(sent()).toEqual([
      {
        method: 'POST',
        path: '/v1/auth/apple',
        body: { idToken: 'fixture-id-token', code: null, nonce: NONCE, intent: 'sign_in' },
      },
      {
        method: 'POST',
        path: '/v1/auth/apple',
        body: {
          idToken: 'fixture-id-token',
          code: 'fixture-code',
          nonce: NONCE,
          intent: 'reauth',
          name: { givenName: 'Fixture', familyName: null },
        },
      },
    ]);
    expect(stub.requests[0]?.body).not.toHaveProperty('name');
  });

  it('posts the Android hand-off code with its nonce', async () => {
    const code = 'h'.repeat(43);
    await postAppleHandoff({ code, nonce: NONCE, intent: 'sign_in', signup: SIGNUP });
    expect(sent()).toEqual([
      {
        method: 'POST',
        path: '/v1/auth/apple/handoff',
        body: { code, nonce: NONCE, intent: 'sign_in', signup: SIGNUP },
      },
    ]);
  });

  it('posts a Google token with the raw nonce', async () => {
    await postGoogleToken({ idToken: 'fixture-id-token', nonce: NONCE, intent: 'sign_in' });
    expect(sent()).toEqual([
      {
        method: 'POST',
        path: '/v1/auth/google',
        body: { idToken: 'fixture-id-token', nonce: NONCE, intent: 'sign_in' },
      },
    ]);
  });

  it('answers a refusal with its code, fields and wait', async () => {
    stub.use([
      {
        method: 'POST',
        path: '/v1/auth/email/verify',
        reply: apiError(422, 'code_invalid', { fields: { code: 'invalid_format' } }),
      },
      {
        method: 'POST',
        path: '/v1/auth/email/start',
        reply: apiError(429, 'rate_limited', { retryAfterSeconds: 30 }),
      },
    ]);

    const refused = await verifyEmailCode({
      pendingToken: PENDING,
      code: '123456',
      intent: 'sign_in',
    });
    const limited = await requestEmailCode({ email: 'fixture@example.test' });

    expect(refused).toEqual({
      ok: false,
      failure: {
        kind: 'api',
        code: 'code_invalid',
        status: 422,
        fields: { code: 'invalid_format' },
        retryAfterSeconds: null,
      },
    });
    expect(limited).toEqual({
      ok: false,
      failure: {
        kind: 'api',
        code: 'rate_limited',
        status: 429,
        fields: {},
        retryAfterSeconds: 30,
      },
    });
  });

  it('answers a network failure', async () => {
    stub.use([{ method: 'POST', path: '/v1/auth/google', reply: { kind: 'network_error' } }]);
    const outcome = await postGoogleToken({
      idToken: 'fixture-id-token',
      nonce: NONCE,
      intent: 'sign_in',
    });
    expect(outcome).toEqual({ ok: false, failure: { kind: 'network' } });
  });
});
