import { describe, expect, it } from 'vitest';

import type { ApiFailure } from '@/lib/view-models/query';

import {
  centredSquare,
  failureOfAttach,
  failureOfPick,
  failureOfPrepare,
  failureOfTicket,
} from './photo-steps';

function api(code: Extract<ApiFailure, { kind: 'api' }>['code'], status: number): ApiFailure {
  return { kind: 'api', code, status, fields: {}, retryAfterSeconds: null };
}

describe('centredSquare', () => {
  it('crops the centred square', () => {
    expect(centredSquare({ width: 4000, height: 3000 })).toEqual({
      originX: 500,
      originY: 0,
      width: 3000,
      height: 3000,
    });
    expect(centredSquare({ width: 3001, height: 4000 })).toEqual({
      originX: 0,
      originY: 499,
      width: 3001,
      height: 3001,
    });
    expect(centredSquare({ width: 1080, height: 1080 })).toEqual({
      originX: 0,
      originY: 0,
      width: 1080,
      height: 1080,
    });
  });
});

describe('failureOfPick', () => {
  it('maps pick outcomes', () => {
    expect(failureOfPick({ kind: 'cancelled' })).toBeNull();
    expect(failureOfPick({ kind: 'denied', state: 'blocked' })).toBe('photos_blocked');
    expect(failureOfPick({ kind: 'denied', state: 'denied' })).toBeNull();
    expect(failureOfPick({ kind: 'denied', state: 'undetermined' })).toBeNull();
    expect(failureOfPick({ kind: 'failed', code: 'upload.picker_failed' })).toBe('prepare_failed');
  });
});

describe('failureOfPrepare', () => {
  it('maps prepare outcomes', () => {
    expect(failureOfPrepare({ kind: 'rejected', reason: 'unsupported_format' })).toBe(
      'unsupported_format',
    );
    expect(failureOfPrepare({ kind: 'rejected', reason: 'photo_too_large' })).toBe(
      'photo_too_large',
    );
    expect(failureOfPrepare({ kind: 'cancelled' })).toBeNull();
    expect(failureOfPrepare({ kind: 'failed', code: 'upload.encode_failed' })).toBe(
      'prepare_failed',
    );
  });
});

describe('failureOfTicket', () => {
  it('maps ticket refusals', () => {
    expect(failureOfTicket(api('daily_limit_reached', 429))).toBe('rate_limited');
    expect(failureOfTicket(api('rate_limited', 429))).toBe('rate_limited');
    expect(failureOfTicket(api('upload_too_large', 422))).toBe('photo_too_large');
    expect(failureOfTicket(api('invalid_request', 400))).toBe('generic');
    expect(failureOfTicket({ kind: 'network' })).toBe('generic');
  });
});

describe('failureOfAttach', () => {
  it('maps attach refusals', () => {
    expect(failureOfAttach(api('upload_invalid', 422))).toBe('upload_failed');
    expect(failureOfAttach(api('rate_limited', 429))).toBe('rate_limited');
    expect(failureOfAttach(api('internal', 500))).toBe('generic');
    expect(failureOfAttach({ kind: 'network' })).toBe('generic');
  });
});
