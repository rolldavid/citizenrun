import { sessions } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, newId } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { sha256Hex } from '@citizenrun/shared/crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-AUTH-09: TEST-api-AUTH, TEST-sessions `logout` and CTL-18's logout row.
const PATH = '/v1/auth/logout';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// auth.logout allows 30 a minute per user and 60 a minute per address.
const PER_USER_MINUTE = 30;
const PER_ADDRESS_MINUTE = 60;
// The test environment's PUBLIC_URL is https, so the cookie carries the host prefix.
const COOKIE_NAME = '__Host-os_session';

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
  // A fixed instant a few seconds into a minute, so no case crosses a minute window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function logout(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, { ip: freshIp(), body: {}, ...options });
}

function clientErrorBody(): Record<string, unknown> {
  return {
    name: 'TypeError',
    code: 'render.failed',
    route: null,
    component: null,
    appVersion: '1.4.0',
    platform: 'ios',
    frames: [{ file: 'src/app/index.tsx', line: 1, column: 1 }],
    requestId: newId(),
  };
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

async function sessionRow(auth: TestAuth) {
  const [row] = await testApp.deps.db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, sha256Hex(auth.token)));
  return row ?? null;
}

async function sessionCount(): Promise<number> {
  return (await testApp.deps.db.select({ id: sessions.id }).from(sessions)).length;
}

/** Whether a bearer token still authenticates: a session-required route answers 204, else 401. */
async function bearerStatus(auth: TestAuth): Promise<number> {
  const response = await testApp.request.post('/v1/client-errors', {
    auth,
    ip: freshIp(),
    body: clientErrorBody(),
  });
  return response.status;
}

/** The Set-Cookie headers of a response that name the session cookie. */
function sessionCookies(response: TestResponse): string[] {
  return response.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
}

function expectClearedCookie(response: TestResponse): void {
  const cookies = sessionCookies(response);
  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) {
    const [pair, ...attributes] = cookie.split(';').map((part) => part.trim());
    expect(pair).toBe(`${COOKIE_NAME}=`);
    expect(attributes).toContain('Max-Age=0');
    expect(attributes).toContain('Path=/');
    expect(attributes).toContain('HttpOnly');
    expect(attributes).toContain('Secure');
    expect(cookie).not.toMatch(/domain/i);
  }
}

describe('POST /v1/auth/logout', () => {
  it('ok', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await logout({ auth });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('a phone session ends', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    expect(await bearerStatus(auth)).toBe(204);
    expect(await sessionRow(auth)).not.toBeNull();
    const response = await logout({ auth });
    expect(response.status).toBe(204);
    expect(await sessionRow(auth)).toBeNull();
    expect(await bearerStatus(auth)).toBe(401);
  });

  it('logout ends this session only', async () => {
    const user = await insertUser(testApp.deps.db);
    const ending = await signIn(testApp.deps.db, user, 'bearer');
    const staying = await signIn(testApp.deps.db, user, 'bearer');
    const other = await signIn(testApp.deps.db, await insertUser(testApp.deps.db), 'bearer');
    expect((await logout({ auth: ending })).status).toBe(204);
    expect(await sessionRow(ending)).toBeNull();
    expect(await sessionRow(staying)).not.toBeNull();
    expect(await bearerStatus(staying)).toBe(204);
    expect(await bearerStatus(other)).toBe(204);
  });

  it('a web logout clears the cookie', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'cookie');
    expect(await sessionRow(auth)).not.toBeNull();
    const response = await logout({ auth });
    expect(response.status).toBe(204);
    expectClearedCookie(response);
    expect(await sessionRow(auth)).toBeNull();
  });

  it('a second logout answers 204', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'cookie');
    expect((await logout({ auth })).status).toBe(204);
    const again = await logout({ auth });
    expect(again.status).toBe(204);
    expectClearedCookie(again);
    expect(await sessionCount()).toBe(0);
  });

  it('a logout with no session answers 204', async () => {
    const user = await insertUser(testApp.deps.db);
    await signIn(testApp.deps.db, user, 'bearer');
    const phone = await logout();
    expect(phone.status).toBe(204);
    expect(phone.headers.get('set-cookie')).toBeNull();
    const web = await logout({ client: 'web/1.4.0' });
    expect(web.status).toBe(204);
    expectClearedCookie(web);
    // No one else's session is touched.
    expect(await sessionCount()).toBe(1);
  });

  it('an invalid bearer answers 401', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    expect((await logout({ auth })).status).toBe(204);
    // The ended token, then a token that never existed.
    await expectEnvelope(await logout({ auth }), 'unauthenticated');
    await expectEnvelope(
      await logout({ auth: { kind: 'bearer', token: 'A'.repeat(43) } }),
      'unauthenticated',
    );
  });

  it('a cookie logout without Origin answers 403', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(await logout({ auth, origin: null }), 'origin_rejected');
    await expectEnvelope(
      await logout({ auth, origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    expect(await sessionRow(auth)).not.toBeNull();
  });

  it('a suspended user can log out', async () => {
    const user = await insertUser(testApp.deps.db, {
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await logout({ auth });
    expect(response.status).toBe(204);
    expect(await sessionRow(auth)).toBeNull();
  });

  it('logout is limited', async () => {
    // The user rule: 30 a minute per user, each logout ending one of 31 sessions.
    const user = await insertUser(testApp.deps.db);
    const auths: TestAuth[] = [];
    for (let n = 0; n <= PER_USER_MINUTE; n += 1) {
      auths.push(await signIn(testApp.deps.db, user, 'bearer'));
    }
    for (const [index, auth] of auths.slice(0, PER_USER_MINUTE).entries()) {
      expect((await logout({ auth })).status, `logout ${String(index + 1)}`).toBe(204);
    }
    const last = auths[PER_USER_MINUTE];
    if (last === undefined) {
      throw new Error('The last session was not made.');
    }
    await expectEnvelope(await logout({ auth: last }), 'rate_limited');
    expect(await sessionRow(last)).not.toBeNull();

    // The address rule: 60 logged-out logouts a minute from one address.
    const ip = '203.0.113.60';
    for (let n = 1; n <= PER_ADDRESS_MINUTE; n += 1) {
      expect((await logout({ ip })).status, `logged-out logout ${String(n)}`).toBe(204);
    }
    const limited = await logout({ ip });
    await expectEnvelope(limited, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toMinuteEnd = Math.ceil((Math.ceil(now / MINUTE_MS) * MINUTE_MS - now) / SECOND_MS);
    expect(limited.headers.get('retry-after')).toBe(String(toMinuteEnd));
    expect((await logout({ ip: '203.0.113.61' })).status).toBe(204);
  });

  it('an unknown key is stripped', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await logout({ auth, body: { pushToken: 'x' } });
    expect(response.status).toBe(204);
    expect(await sessionRow(auth)).toBeNull();
    expect(await sessionCount()).toBe(0);
  });

  it('rejects invalid input', async () => {
    const response = await testApp.app.request(
      new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Client': 'ios/1.4.0',
          'x-real-ip': freshIp(),
        },
        body: '{"unterminated',
      },
    );
    await expectEnvelope(response, 'invalid_request');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(
      await logout({ auth: { kind: 'bearer', token: 'not a token' } }),
      'unauthenticated',
    );
    await expectEnvelope(await logout({ client: 'web/1.4.0', origin: null }), 'origin_rejected');
  });

  it('the session token reaches no log line', async () => {
    const user = await insertUser(testApp.deps.db);
    const bearer = await signIn(testApp.deps.db, user, 'bearer');
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    expect((await logout({ auth: bearer })).status).toBe(204);
    expect((await logout({ auth: cookie })).status).toBe(204);
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(bearer.token);
      expect(line.raw).not.toContain(cookie.token);
    }
  });
});
