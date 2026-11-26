import { authChallenges } from '@citizenrun/db';
import { ERROR_CODES, ErrorEnvelopeSchema, NonceResultSchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { sha256Hex, verifyToken } from '@citizenrun/shared/crypto';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { consumeNonce, findUsableNonce } from '../../services/auth/nonces.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertChallenge } from '../../testing/factories.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-AUTH-03: TEST-api-AUTH and CTL-13's nonce cases.
const PATH = '/v1/auth/nonce';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
// auth.nonce allows 60 an hour per address.
const PER_ADDRESS_HOURLY = 60;

type NonceResult = { nonce: string; nonceHash: string; state: string; expiresAt: string };

// Every request comes from its own address unless a case names one.
let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // A fixed instant a few minutes into an hour, so no case crosses an hour window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + 5 * MINUTE_MS));
});

function createNonce(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, { ip: freshIp(), body: {}, ...options });
}

async function nonceOk(options: TestRequestOptions = {}): Promise<NonceResult> {
  const response = await createNonce(options);
  expect(response.status).toBe(200);
  const body = await response.json<NonceResult>();
  expect(NonceResultSchema.safeParse(body).success).toBe(true);
  return body;
}

// A request whose body text is sent as given.
function postRaw(text: string): Promise<Response> {
  return Promise.resolve(
    testApp.app.request(new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OS-Client': 'ios/1.4.0',
        'x-real-ip': freshIp(),
      },
      body: text,
    }),
  );
}

/** Asserts the exact envelope of `code` with an `X-Request-Id`. */
async function expectEnvelope(response: TestResponse | Response, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body: unknown = JSON.parse(await response.text());
  expect(body).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: expect.any(Object) },
  });
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
}

async function challengeRows() {
  return testApp.deps.db.select().from(authChallenges);
}

describe('POST /v1/auth/nonce', () => {
  it('ok', async () => {
    const result = await nonceOk();
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'nonce', 'nonceHash', 'state']);
    expect(result.nonce).toMatch(TOKEN_PATTERN);
    expect(result.nonceHash).toMatch(HEX_64);
    const rows = await challengeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'nonce', userId: null, sessionId: null, usedAt: null });
  });

  it('stores only the hash', async () => {
    const result = await nonceOk();
    const [row] = await challengeRows();
    expect(row?.secretHash).toBe(result.nonceHash);
    expect(row?.secretHash).toBe(sha256Hex(result.nonce));
    const stored = await testApp.deps.db.execute<{ text: string }>(
      sql`select coalesce(string_agg(t::text, ''), '') as text from auth_challenges t`,
    );
    const text = stored.rows[0]?.text ?? '';
    expect(text).toContain(result.nonceHash);
    expect(text).not.toContain(result.nonce);
    expect(text).not.toContain(result.state);
  });

  it('state carries the nonce hash', async () => {
    const result = await nonceOk();
    const now = testApp.deps.clock.now();
    expect(verifyToken(testApp.deps.keyRing, 'apple_state', result.state, now)).toEqual({
      n: result.nonceHash,
    });
    // Signed tokens are bound to their purpose (CTL-07).
    expect(verifyToken(testApp.deps.keyRing, 'unsubscribe', result.state, now)).toBeNull();
    // The state lives 600 seconds.
    const later = new Date(now.getTime() + 600 * SECOND_MS);
    expect(verifyToken(testApp.deps.keyRing, 'apple_state', result.state, later)).toBeNull();
  });

  it('expires in 10 minutes', async () => {
    const result = await nonceOk();
    const expected = new Date(testApp.deps.clock.now().getTime() + 10 * MINUTE_MS);
    expect(result.expiresAt).toBe(expected.toISOString());
    const [row] = await challengeRows();
    expect(row?.expiresAt.toISOString()).toBe(expected.toISOString());
  });

  it('records the platform', async () => {
    await nonceOk({ client: 'android/1.4.0' });
    await nonceOk({ client: 'web/1.4.0' });
    await nonceOk();
    const rows = await challengeRows();
    expect(rows.map((row) => row.platform).sort()).toEqual(['android', 'ios', 'web']);
  });

  it('each call issues a new nonce', async () => {
    const first = await nonceOk();
    const second = await nonceOk();
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.nonceHash).not.toBe(first.nonceHash);
    expect(await challengeRows()).toHaveLength(2);
  });

  it('rejects invalid input', async () => {
    // An unknown key is dropped and never stored.
    const extra = await createNonce({ body: { nonce: 'chosen-by-the-client', platform: 'x' } });
    expect(extra.status).toBe(200);
    const [row] = await challengeRows();
    expect(row?.secretHash).not.toBe(sha256Hex('chosen-by-the-client'));
    expect(row?.platform).toBe('ios');
    await expectEnvelope(await postRaw('{"unterminated'), 'invalid_request');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await createNonce({ client: null }), 'client_header_required');
    await expectEnvelope(
      await createNonce({ client: 'web/1.4.0', origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
  });

  it('sixty an hour per address', async () => {
    const ip = '203.0.113.60';
    for (let n = 1; n <= PER_ADDRESS_HOURLY; n += 1) {
      const response = await createNonce({ ip });
      expect(response.status, `call ${String(n)}`).toBe(200);
    }
    await expectEnvelope(await createNonce({ ip }), 'rate_limited');
    expect(await challengeRows()).toHaveLength(PER_ADDRESS_HOURLY);
    expect((await createNonce({ ip: '203.0.113.61' })).status).toBe(200);
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.62';
    for (let n = 1; n <= PER_ADDRESS_HOURLY; n += 1) {
      expect((await createNonce({ ip })).status, `call ${String(n)}`).toBe(200);
    }
    const limited = await createNonce({ ip });
    await expectEnvelope(limited, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toHourEnd = Math.ceil((Math.ceil(now / HOUR_MS) * HOUR_MS - now) / SECOND_MS);
    expect(limited.headers.get('retry-after')).toBe(String(toHourEnd));
  });

  it('a web call needs our Origin', async () => {
    await expectEnvelope(
      await createNonce({ client: 'web/1.4.0', origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    await expectEnvelope(
      await createNonce({ client: 'web/1.4.0', origin: null }),
      'origin_rejected',
    );
    expect(await challengeRows()).toHaveLength(0);
    expect((await createNonce({ client: 'web/1.4.0' })).status).toBe(200);
    expect((await createNonce({ client: 'ios/1.4.0', origin: null })).status).toBe(200);
    expect(await challengeRows()).toHaveLength(2);
  });

  it('an issued nonce is consumed once', async () => {
    // The lookup and the consume compare with the database's now() (T-auth_challenges), so the
    // nonce is issued at the real time here, not at the hour-aligned fake time.
    testApp.deps.clock.set(new Date(Date.now()));
    const result = await nonceOk({ client: 'android/1.4.0' });
    const db = testApp.deps.db;
    expect(await findUsableNonce(db, result.nonce)).toEqual({
      secretHash: result.nonceHash,
      platform: 'android',
    });
    // Neither the hash nor a random value finds it: the lookup takes the raw nonce.
    expect(await findUsableNonce(db, result.nonceHash)).toBeNull();
    const first = await db.transaction((tx) => consumeNonce(tx, result.nonceHash));
    expect(first).toBe(true);
    const replay = await db.transaction((tx) => consumeNonce(tx, result.nonceHash));
    expect(replay).toBe(false);
    expect(await findUsableNonce(db, result.nonce)).toBeNull();
    const [row] = await challengeRows();
    expect(row?.usedAt).not.toBeNull();
  });

  it('an expired nonce or another kind is not usable', async () => {
    const db = testApp.deps.db;
    const expired = await insertChallenge(db, {
      kind: 'nonce',
      expiresAt: new Date(Date.now() - MINUTE_MS),
    });
    const handoff = await insertChallenge(db, { kind: 'apple_handoff', platform: 'android' });
    for (const challenge of [expired, handoff]) {
      const secret = challenge.secret ?? '';
      expect(await findUsableNonce(db, secret)).toBeNull();
      expect(await db.transaction((tx) => consumeNonce(tx, sha256Hex(secret)))).toBe(false);
    }
    const rows = await challengeRows();
    expect(rows.map((row) => row.usedAt)).toEqual([null, null]);
  });

  it('nonce values reach no log line', async () => {
    const result = await nonceOk();
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(result.nonce);
      expect(line.raw).not.toContain(result.nonceHash);
      expect(line.raw).not.toContain(result.state);
    }
  });
});
