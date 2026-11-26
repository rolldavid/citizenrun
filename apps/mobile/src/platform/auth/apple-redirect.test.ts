import { describe, expect, it } from 'vitest';

import {
  APPLE_CALLBACK_ERRORS,
  appleAuthorizeUrl,
  appleReturnUrl,
  parseAppleReturn,
} from './apple-redirect';

const CODE_43 = 'A'.repeat(20) + 'b_-'.repeat(1) + '9'.repeat(20);
const RETURN = 'fixture-scheme://auth/apple';

function success(query: string): { type: 'success'; url: string } {
  return { type: 'success', url: `${RETURN}?${query}` };
}

describe('appleAuthorizeUrl', () => {
  it('authorize URL has exactly seven parameters', () => {
    const url = new URL(
      appleAuthorizeUrl({
        servicesId: 'svc.example.test',
        apiOrigin: 'https://api.example.test',
        state: 's',
        nonceHash: 'h',
      }),
    );
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('appleid.apple.com');
    expect(url.pathname).toBe('/auth/authorize');
    expect([...url.searchParams.entries()]).toEqual([
      ['client_id', 'svc.example.test'],
      ['redirect_uri', 'https://api.example.test/v1/auth/apple/callback'],
      ['response_type', 'code id_token'],
      ['response_mode', 'form_post'],
      ['scope', 'name email'],
      ['state', 's'],
      ['nonce', 'h'],
    ]);
  });
});

describe('appleReturnUrl', () => {
  it('return URL uses the scheme', () => {
    expect(appleReturnUrl('fixture-scheme')).toBe('fixture-scheme://auth/apple');
  });
});

describe('parseAppleReturn', () => {
  it('the fixture code has the hand-off length', () => {
    expect(CODE_43).toHaveLength(43);
  });

  it('matching state is a hand-off', () => {
    expect(parseAppleReturn(success(`code=${CODE_43}&state=s`), 's')).toEqual({
      kind: 'handoff',
      code: CODE_43,
    });
  });

  it('another state is refused', () => {
    expect(parseAppleReturn(success(`code=${CODE_43}&state=t`), 's')).toEqual({
      kind: 'failed',
      code: 'auth.state_mismatch',
    });
    expect(parseAppleReturn(success(`code=${CODE_43}&state=ss`), 's')).toEqual({
      kind: 'failed',
      code: 'auth.state_mismatch',
    });
    expect(parseAppleReturn(success(`code=${CODE_43}`), 's')).toEqual({
      kind: 'failed',
      code: 'auth.state_mismatch',
    });
  });

  it('cancelled by the user', () => {
    expect(parseAppleReturn(success('error=cancelled'), 's')).toEqual({ kind: 'cancelled' });
    expect(parseAppleReturn({ type: 'dismiss' }, 's')).toEqual({ kind: 'cancelled' });
    expect(parseAppleReturn({ type: 'cancel' }, 's')).toEqual({ kind: 'cancelled' });
  });

  it('server refusals pass through', () => {
    expect(parseAppleReturn(success('error=signups_closed'), 's')).toEqual({
      kind: 'server_refused',
      reason: 'signups_closed',
    });
    expect(parseAppleReturn(success('error=provider_not_configured'), 's')).toEqual({
      kind: 'server_refused',
      reason: 'provider_not_configured',
    });
    expect(APPLE_CALLBACK_ERRORS).toHaveLength(11);
    for (const reason of APPLE_CALLBACK_ERRORS) {
      expect(parseAppleReturn(success(`error=${reason}&state=s`), 's')).toEqual({
        kind: 'server_refused',
        reason,
      });
    }
  });

  it('unknown error', () => {
    expect(parseAppleReturn(success('error=teapot'), 's')).toEqual({
      kind: 'failed',
      code: 'auth.provider_error',
    });
  });

  it('malformed code', () => {
    expect(parseAppleReturn(success(`code=${CODE_43.slice(1)}&state=s`), 's')).toEqual({
      kind: 'failed',
      code: 'auth.provider_error',
    });
    expect(
      parseAppleReturn(success(`code=${encodeURIComponent('+' + CODE_43.slice(1))}&state=s`), 's'),
    ).toEqual({ kind: 'failed', code: 'auth.provider_error' });
    expect(parseAppleReturn(success('state=s'), 's')).toEqual({
      kind: 'failed',
      code: 'auth.provider_error',
    });
  });

  it('unparseable URL', () => {
    expect(() => parseAppleReturn({ type: 'success', url: 'not a url' }, 's')).not.toThrow();
    expect(parseAppleReturn({ type: 'success', url: 'not a url' }, 's')).toEqual({
      kind: 'failed',
      code: 'auth.provider_error',
    });
  });
});
