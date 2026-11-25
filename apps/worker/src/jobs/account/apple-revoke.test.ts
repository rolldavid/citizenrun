import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { createFakeOutbound } from '../../testing/fakes/outbound.ts';
import { RetryableJobError } from '../types.ts';
import { appleClientSecret, appleRevokeConfig, revokeAppleToken } from './apple-revoke.ts';
import type { AppleRevokeConfig } from './apple-revoke.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PRIVATE_KEY_PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const CONFIG: AppleRevokeConfig = {
  teamId: 'fixture-team',
  keyId: 'fixture-key',
  privateKeyPem: PRIVATE_KEY_PEM,
};
const CLIENT_ID = 'fixture.services.id';
const REFRESH_TOKEN = 'fixture-refresh-token';
const NOW = new Date('2027-03-05T22:00:00.750Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

function revokeWith(
  answer: () => { status: number } | Promise<{ status: number }>,
): Promise<'revoked' | 'rejected'> {
  const fake = createFakeOutbound();
  fake.on('appleid.apple.com', 'POST', '/auth/revoke', answer);
  return revokeAppleToken(fake.fetch, {
    config: CONFIG,
    clientId: CLIENT_ID,
    refreshToken: REFRESH_TOKEN,
    now: NOW,
    signal: new AbortController().signal,
  });
}

describe('apple revocation', () => {
  it('returns no config while any variable is unset', () => {
    const set = {
      APPLE_TEAM_ID: 'fixture-team',
      APPLE_KEY_ID: 'fixture-key',
      APPLE_PRIVATE_KEY: PRIVATE_KEY_PEM,
    };
    expect(appleRevokeConfig({ ...set, APPLE_TEAM_ID: null })).toBeNull();
    expect(appleRevokeConfig({ ...set, APPLE_KEY_ID: null })).toBeNull();
    expect(appleRevokeConfig({ ...set, APPLE_PRIVATE_KEY: null })).toBeNull();
    expect(appleRevokeConfig(set)).toEqual(CONFIG);
  });

  it('signs an ES256 client secret', async () => {
    const first = await appleClientSecret(CONFIG, CLIENT_ID, NOW);
    const second = await appleClientSecret(CONFIG, CLIENT_ID, NOW);

    expect(decodeProtectedHeader(first)).toEqual({ alg: 'ES256', kid: 'fixture-key' });
    for (const secret of [first, second]) {
      const { payload } = await jwtVerify(secret, publicKey, {
        algorithms: ['ES256'],
        issuer: 'fixture-team',
        audience: 'https://appleid.apple.com',
        currentDate: NOW,
      });
      expect(payload.iss).toBe('fixture-team');
      expect(payload.aud).toBe('https://appleid.apple.com');
      expect(payload.sub).toBe(CLIENT_ID);
      expect(payload.iat).toBe(NOW_S);
      expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
    }
  });

  it('posts the form to the revoke endpoint', async () => {
    const fake = createFakeOutbound();
    fake.on('appleid.apple.com', 'POST', '/auth/revoke', () => ({ status: 200 }));

    const result = await revokeAppleToken(fake.fetch, {
      config: CONFIG,
      clientId: CLIENT_ID,
      refreshToken: REFRESH_TOKEN,
      now: NOW,
      signal: new AbortController().signal,
    });

    expect(result).toBe('revoked');
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call?.host).toBe('appleid.apple.com');
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/auth/revoke');
    expect(call?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(call?.body ?? '');
    expect([...form.keys()].sort()).toEqual([
      'client_id',
      'client_secret',
      'token',
      'token_type_hint',
    ]);
    expect(form.get('client_id')).toBe(CLIENT_ID);
    expect(form.get('token')).toBe(REFRESH_TOKEN);
    expect(form.get('token_type_hint')).toBe('refresh_token');
    const secret = form.get('client_secret') ?? '';
    const { payload } = await jwtVerify(secret, publicKey, {
      algorithms: ['ES256'],
      currentDate: NOW,
    });
    expect(payload.sub).toBe(CLIENT_ID);
    // The four fields above are the whole request: no user id, address or handle.
    expect(call?.body).not.toContain('@');
    expect(call?.path).not.toContain('?');
  });

  it('a refusal is not retried', async () => {
    await expect(revokeWith(() => ({ status: 400 }))).resolves.toBe('rejected');
  });

  it('an outage is retried', async () => {
    await expect(revokeWith(() => ({ status: 503 }))).rejects.toBeInstanceOf(RetryableJobError);
    await expect(revokeWith(() => ({ status: 429 }))).rejects.toBeInstanceOf(RetryableJobError);
    await expect(
      revokeWith(() => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toBeInstanceOf(RetryableJobError);
  });

  it('a shutdown abort is retried and makes no call', async () => {
    const fake = createFakeOutbound();
    fake.on('appleid.apple.com', 'POST', '/auth/revoke', () => ({ status: 200 }));
    const abort = new AbortController();
    abort.abort();

    const revoking = revokeAppleToken(fake.fetch, {
      config: CONFIG,
      clientId: CLIENT_ID,
      refreshToken: REFRESH_TOKEN,
      now: NOW,
      signal: abort.signal,
    });

    await expect(revoking).rejects.toMatchObject({ name: 'RetryableJobError', reason: 'shutdown' });
    expect(fake.calls).toHaveLength(0);
  });
});
