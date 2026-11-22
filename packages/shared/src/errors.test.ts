import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES, FIELD_CODES, assertNever } from './errors.ts';

const STATUSES = [400, 401, 403, 404, 409, 413, 422, 426, 429, 500, 503];

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

  it('holds exactly the nine codes the registry starts with', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([
      'client_header_required',
      'internal',
      'invalid_cursor',
      'invalid_request',
      'not_found',
      'payload_too_large',
      'rate_limited',
      'unavailable',
      'upgrade_required',
    ]);
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
