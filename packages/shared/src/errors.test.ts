import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES, FIELD_CODES, assertNever } from './errors.ts';
import type { ErrorCode } from './errors.ts';
import { errors } from './i18n/en/errors.ts';

const STATUSES = [400, 401, 403, 404, 409, 413, 422, 426, 429, 500, 503];

const STARTING_CODES = [
  'client_header_required',
  'internal',
  'invalid_cursor',
  'invalid_request',
  'not_found',
  'payload_too_large',
  'rate_limited',
  'unavailable',
  'upgrade_required',
];

// The account codes and their statuses, written out by hand (L-error-registry).
const ACCOUNT_CODE_STATUSES: Record<string, number> = {
  signature_invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  origin_rejected: 403,
  account_suspended: 403,
  recent_sign_in_required: 403,
  onboarding_incomplete: 403,
  daily_limit_reached: 429,
  email_undeliverable: 422,
  email_signin_paused: 503,
  code_invalid: 422,
  code_expired: 422,
  code_attempts_exhausted: 422,
  identity_token_invalid: 422,
  nonce_invalid: 422,
  handoff_invalid: 422,
  provider_not_configured: 503,
  signup_details_required: 422,
  consent_version_outdated: 422,
  signup_limit_reached: 429,
  account_deleting: 403,
  reauth_mismatch: 409,
  email_already_set: 409,
  email_in_use: 409,
  handle_taken: 409,
  handle_reserved: 409,
  handle_change_too_soon: 422,
  ai_consent_required: 422,
  unknown_issue: 422,
  upload_invalid: 422,
  onboarding_step_mismatch: 409,
  export_not_ready: 409,
  unavailable_in_state: 403,
  age_signal_required: 422,
  upload_too_large: 422,
};

// The codes the admin bundle routes answer with, and their statuses.
const BUNDLE_CODE_STATUSES: Record<string, number> = {
  bundle_busy: 409,
  bundle_not_reloadable: 409,
  bundle_not_held: 409,
  bundle_not_revertable: 409,
};

describe('error registry', () => {
  it('every error code maps to one status', () => {
    const entries = Object.entries(ERROR_CODES);
    expect(new Set(entries.map(([code]) => code)).size).toBe(entries.length);
    for (const [code, { status, message }] of entries) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(STATUSES).toContain(status);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain('{{');
    }
    expect(ERROR_CODES.internal).toEqual({ status: 500, message: 'Internal error.' });
  });

  it('holds exactly the starting codes, the account codes and the bundle codes', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(
      [
        ...STARTING_CODES,
        ...Object.keys(ACCOUNT_CODE_STATUSES),
        ...Object.keys(BUNDLE_CODE_STATUSES),
      ].sort(),
    );
  });

  it('every bundle code has its status', () => {
    for (const [code, status] of Object.entries(BUNDLE_CODE_STATUSES)) {
      expect(Object.hasOwn(ERROR_CODES, code), code).toBe(true);
      expect(Object.entries(ERROR_CODES).find(([key]) => key === code)?.[1].status, code).toBe(
        status,
      );
    }
  });

  it('every account code has its status', () => {
    const registered = Object.fromEntries(
      Object.keys(ACCOUNT_CODE_STATUSES).map((code) => [
        code,
        Object.hasOwn(ERROR_CODES, code)
          ? ERROR_CODES[code as ErrorCode].status // narrowed by the hasOwn check above
          : null,
      ]),
    );
    expect(registered).toEqual(ACCOUNT_CODE_STATUSES);
    expect(Object.keys(ACCOUNT_CODE_STATUSES)).toHaveLength(35);
  });

  it('no later code is registered', () => {
    for (const code of [
      'signups_closed',
      'account_banned',
      'text_not_allowed',
      'link_not_allowed_yet',
      'posting_paused',
      'id_conflict',
      'email_required',
      'address_not_found',
      'source_not_official',
      'measure_recently_reviewed',
    ]) {
      expect(Object.hasOwn(ERROR_CODES, code)).toBe(false);
    }
  });

  it('every code has catalog text', () => {
    const keys = Object.keys(errors).filter((key) => key !== 'generic');
    expect(keys.sort()).toEqual(Object.keys(ERROR_CODES).sort());
    for (const text of Object.values(errors)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('the texts the screens quote are the registry texts', () => {
    expect(errors.reauth_mismatch).toBe(
      'That is a different account. Sign in with the one you are using.',
    );
    expect(errors.email_in_use).toBe('That email belongs to another account.');
    expect(errors.email_undeliverable).toBe(
      "We can't send email to that address. Use another one.",
    );
    expect(errors.email_signin_paused).toBe(
      'Sign-in by email is paused. Try Apple or Google, or try again later.',
    );
    expect(errors.handle_change_too_soon).toBe(
      'You changed your handle recently. You can change it again on {{date}}.',
    );
  });

  it('names the product only through appName', () => {
    expect(errors.unavailable_in_state).toBe("{{appName}} isn't available in your state yet.");
  });

  it('lists each field code once', () => {
    expect(new Set(FIELD_CODES).size).toBe(FIELD_CODES.length);
  });
});

describe('ApiError', () => {
  it('ApiError carries its code, status and fields', () => {
    const err = new ApiError('invalid_request', { fields: { handle: 'too_short' } });
    expect(err.status).toBe(400);
    expect(err.fields.handle).toBe('too_short');
    expect(err.retryAfterSeconds).toBeNull();
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('The request is not valid.');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults fields to empty and keeps a retry delay', () => {
    const err = new ApiError('rate_limited', { retryAfterSeconds: 30 });
    expect(err.fields).toEqual({});
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.status).toBe(429);
  });
});

describe('assertNever', () => {
  it('assertNever throws without the value', () => {
    const unexpected = 'secret' as never; // a value the types say cannot occur, as from input
    let caught: unknown = null;
    try {
      assertNever(unexpected);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : 'secret').not.toContain('secret');
  });
});
