import { describe, expect, it } from 'vitest';

import type { ApiFailure } from '@/lib/view-models/query';

import { localHandleCheck, serverHandleCheck, setHandleRefusal } from './handle-check';

function api(
  code: Extract<ApiFailure, { kind: 'api' }>['code'],
  status: number,
  fields: Record<string, string> = {},
): ApiFailure {
  return { kind: 'api', code, status, fields, retryAfterSeconds: null };
}

const NO_REQUEST = { handle: null, askServer: false };

describe('localHandleCheck', () => {
  it('maps every refusal of the device check', () => {
    expect(localHandleCheck('ab', null)).toEqual({
      state: { check: 'invalid', invalidReason: 'too_short' },
      ...NO_REQUEST,
    });
    expect(localHandleCheck('a'.repeat(21), null)).toEqual({
      state: { check: 'invalid', invalidReason: 'too_long' },
      ...NO_REQUEST,
    });
    expect(localHandleCheck('a-b', null)).toEqual({
      state: { check: 'invalid', invalidReason: 'characters' },
      ...NO_REQUEST,
    });
    expect(localHandleCheck('.ab', null)).toEqual({
      state: { check: 'invalid', invalidReason: 'dots' },
      ...NO_REQUEST,
    });
    expect(localHandleCheck('a..b', null)).toEqual({
      state: { check: 'invalid', invalidReason: 'dots' },
      ...NO_REQUEST,
    });
    expect(localHandleCheck('___', null)).toEqual({
      state: { check: 'invalid', invalidReason: 'no_letter' },
      ...NO_REQUEST,
    });
    expect(localHandleCheck('admin', null)).toEqual({
      state: { check: 'reserved', invalidReason: null },
      ...NO_REQUEST,
    });
  });

  it('makes no request for an empty value', () => {
    expect(localHandleCheck('', 'test_fixture')).toEqual({
      state: { check: 'idle', invalidReason: null },
      ...NO_REQUEST,
    });
  });

  it('asks the server only for a valid new handle', () => {
    expect(localHandleCheck('test_new', null)).toEqual({
      state: { check: 'checking', invalidReason: null },
      handle: 'test_new',
      askServer: true,
    });
    expect(localHandleCheck('@Test_New', 'test_fixture')).toEqual({
      state: { check: 'checking', invalidReason: null },
      handle: 'test_new',
      askServer: true,
    });
  });

  it("treats the person's own handle as free without asking", () => {
    expect(localHandleCheck('test_fixture', 'test_fixture')).toEqual({
      state: { check: 'free', invalidReason: null },
      handle: 'test_fixture',
      askServer: false,
    });
  });
});

describe('serverHandleCheck', () => {
  it("maps the server's answer", () => {
    expect(serverHandleCheck({ handle: 'test_new', available: true, reason: null })).toEqual({
      check: 'free',
      invalidReason: null,
    });
    expect(serverHandleCheck({ handle: 'test_new', available: false, reason: 'taken' })).toEqual({
      check: 'taken',
      invalidReason: null,
    });
    expect(serverHandleCheck({ handle: 'test_new', available: false, reason: 'reserved' })).toEqual(
      { check: 'reserved', invalidReason: null },
    );
    expect(serverHandleCheck({ handle: 'test_new', available: false, reason: 'invalid' })).toEqual({
      check: 'invalid',
      invalidReason: 'characters',
    });
  });
});

describe('setHandleRefusal', () => {
  it('maps every refusal of setting the handle', () => {
    expect(setHandleRefusal(api('handle_taken', 409))).toEqual({
      kind: 'check',
      state: { check: 'taken', invalidReason: null },
    });
    expect(setHandleRefusal(api('handle_reserved', 409))).toEqual({
      kind: 'check',
      state: { check: 'reserved', invalidReason: null },
    });
    expect(setHandleRefusal(api('invalid_request', 400, { handle: 'too_short' }))).toEqual({
      kind: 'check',
      state: { check: 'invalid', invalidReason: 'too_short' },
    });
    expect(setHandleRefusal(api('invalid_request', 400, { handle: 'too_long' }))).toEqual({
      kind: 'check',
      state: { check: 'invalid', invalidReason: 'too_long' },
    });
    expect(setHandleRefusal(api('invalid_request', 400, { handle: 'invalid_format' }))).toEqual({
      kind: 'check',
      state: { check: 'invalid', invalidReason: 'characters' },
    });
    expect(setHandleRefusal(api('handle_change_too_soon', 422))).toEqual({
      kind: 'error',
      errorCode: 'handle_change_too_soon',
    });
    expect(setHandleRefusal(api('rate_limited', 429))).toEqual({
      kind: 'error',
      errorCode: 'rate_limited',
    });
    expect(setHandleRefusal({ kind: 'network' })).toEqual({
      kind: 'error',
      errorCode: 'unavailable',
    });
  });
});
