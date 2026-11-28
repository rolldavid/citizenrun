import { readFile } from 'node:fs/promises';
import { dayPeriod, usageCounters } from '@citizenrun/db';
import { ERROR_CODES, ErrorEnvelopeSchema, LEGAL_VERSIONS } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createRouteMetaIndex } from '../../middleware/route-meta.ts';
import { buildOpenApiDocument } from '../../openapi.ts';
import { OPENAPI_FILE } from '../../scripts/gen-openapi.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp, TestAppOverrides } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';
import { DevMailboxResultSchema } from './read-dev-mailbox.ts';

// E-AUTH-11: the local development mailbox the end-to-end journeys read sign-in codes from.
const PATH = '/v1/dev/mailbox';
const START = '/v1/auth/email/start';
const VERIFY = '/v1/auth/email/verify';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEV_ROUTES = { ENABLE_DEV_ROUTES: 'true' } as const;
// dev.mailbox allows 120 a minute per address, held in memory at half per replica (D-240).
const PER_REPLICA_MINUTE = 60;
const SIGNUP = {
  age: { method: 'none', sourceTier: null },
  agreements: {
    termsVersion: LEGAL_VERSIONS.terms,
    contentPolicyVersion: LEGAL_VERSIONS.content_policy,
    privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
  },
  aiScreening: true,
};

type StartResult = { pendingToken: string };

// Every request comes from its own address unless a case names one.
let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

async function devApp(overrides: TestAppOverrides = {}): Promise<TestApp> {
  const testApp = await createTestApp({ ...overrides, env: { ...DEV_ROUTES, ...overrides.env } });
  // A fixed instant a few seconds into a minute, so no case crosses a minute window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
  return testApp;
}

/** The mailbox as test tooling calls it: no client header and no Origin. */
function readMailbox(
  testApp: TestApp,
  to: string,
  options: TestRequestOptions = {},
): Promise<TestResponse> {
  return testApp.request.post(PATH, {
    ip: freshIp(),
    client: null,
    origin: null,
    body: { to },
    ...options,
  });
}

async function start(testApp: TestApp, email: string, pendingToken?: string): Promise<StartResult> {
  const response = await testApp.request.post(START, {
    ip: freshIp(),
    body: pendingToken === undefined ? { email } : { email, pendingToken },
  });
  expect(response.status).toBe(200);
  return response.json<StartResult>();
}

async function mailboxCode(testApp: TestApp, to: string): Promise<string> {
  const response = await readMailbox(testApp, to);
  expect(response.status).toBe(200);
  const body = await response.json<{ code: string }>();
  expect(DevMailboxResultSchema.safeParse(body).success).toBe(true);
  expect(Object.keys(body)).toEqual(['code']);
  return body.code;
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

async function emailDayCount(testApp: TestApp): Promise<number | null> {
  const [row] = await testApp.deps.db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.name, 'email.day'),
        eq(usageCounters.period, dayPeriod(testApp.deps.clock.now())),
      ),
    );
  return row?.count ?? null;
}

describe('POST /v1/dev/mailbox', () => {
  it('answers the newest code', async () => {
    const testApp = await devApp();
    const email = 'person@example.test';
    const { pendingToken } = await start(testApp, email);
    const code = await mailboxCode(testApp, email);
    expect(code).toMatch(/^[0-9]{6}$/);
    const verified = await testApp.request.post(VERIFY, {
      ip: freshIp(),
      body: { pendingToken, code, signup: SIGNUP },
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ created: true });
  });

  it('reads through the counted mailer', async () => {
    const testApp = await devApp();
    // The composition server.ts builds: the counted wrapper, not the fake inside it.
    expect(testApp.deps.mailer).not.toBe(testApp.fakes.mailer);
    const email = 'counted@example.test';
    await start(testApp, email);
    const code = await mailboxCode(testApp, email);
    expect(code).toBe(testApp.fakes.mailer.codeFor(email));
    expect(await emailDayCount(testApp)).toBe(1);
  });

  it('a resend gives the new code', async () => {
    const testApp = await devApp();
    const email = 'resend@example.test';
    const { pendingToken } = await start(testApp, email);
    testApp.deps.clock.advance(31 * SECOND_MS);
    await start(testApp, email, pendingToken);
    expect(testApp.fakes.mailer.sent).toHaveLength(2);
    const [, resent] = testApp.fakes.mailer.sent;
    const code = await mailboxCode(testApp, email);
    expect(resent?.text).toContain(code);
    expect(code).toBe(testApp.fakes.mailer.codeFor(email));
    const verified = await testApp.request.post(VERIFY, {
      ip: freshIp(),
      body: { pendingToken, code, signup: SIGNUP },
    });
    expect(verified.status).toBe(200);
  });

  it('reads only the address asked for, normalised', async () => {
    const testApp = await devApp();
    await start(testApp, 'first@example.test');
    await start(testApp, 'second@example.test');
    expect(await mailboxCode(testApp, '  FIRST@Example.test ')).toBe(
      testApp.fakes.mailer.codeFor('first@example.test'),
    );
    expect(await mailboxCode(testApp, 'second@example.test')).toBe(
      testApp.fakes.mailer.codeFor('second@example.test'),
    );
  });

  it('an address with no captured code answers 404', async () => {
    const testApp = await devApp();
    await start(testApp, 'someone@example.test');
    await expectEnvelope(await readMailbox(testApp, 'nobody@example.test'), 'not_found');
  });

  it('a message that is not a sign-in code is not read', async () => {
    const testApp = await devApp();
    const email = 'other-mail@example.test';
    await testApp.deps.mailer.sendEmail({
      to: email,
      subject: 'Fixture',
      text: 'Fixture message 123456',
      html: '<p>Fixture message 123456</p>',
      idempotencyKey: 'fixture-not-signin-1',
    });
    await expectEnvelope(await readMailbox(testApp, email), 'not_found');
  });

  it('not registered without dev routes', async () => {
    const testApp = await createTestApp({ env: { ENABLE_DEV_ROUTES: undefined } });
    expect(testApp.deps.env.devRoutes).toBe(false);
    const email = 'nodev@example.test';
    await start(testApp, email);
    await expectEnvelope(await readMailbox(testApp, email), 'not_found');
    await expectEnvelope(await readMailbox(testApp, email, { client: 'ios/1.4.0' }), 'not_found');
  });

  it('not registered with a real mailer', async () => {
    const testApp = await createTestApp({
      env: {
        ...DEV_ROUTES,
        RESEND_API_KEY: 're_fixture_key',
        EMAIL_FROM: 'Fixture <login@example.test>',
      },
    });
    expect(testApp.deps.env.captureMail).toBe(false);
    expect(testApp.deps.env.devRoutes).toBe(true);
    await expectEnvelope(await readMailbox(testApp, 'person@example.test'), 'not_found');
    expect(testApp.fakes.outbound.calls).toHaveLength(0);
  });

  it('never in the OpenAPI document', async () => {
    expect(JSON.stringify(buildOpenApiDocument())).not.toContain('/v1/dev/mailbox');
    expect(JSON.stringify(buildOpenApiDocument())).not.toContain('readDevMailbox');
    const committed = await readFile(OPENAPI_FILE, 'utf8');
    expect(committed).not.toContain('/v1/dev/mailbox');
    expect(committed).not.toContain('readDevMailbox');
    // The document an app with the mailbox serves does not hold it either.
    const testApp = await devApp();
    const served = await testApp.request.get('/v1/openapi.json', { client: null });
    expect(served.status).toBe(200);
    const text = await served.text();
    expect(text).toContain('/v1/auth/nonce');
    expect(text).not.toContain('/v1/dev/mailbox');
  });

  it('needs no client header and no Origin', async () => {
    const testApp = await devApp();
    const email = 'tooling@example.test';
    await start(testApp, email);
    const response = await readMailbox(testApp, email, { client: null, origin: null });
    expect(response.status).toBe(200);
  });

  it('its metadata reaches the route index', async () => {
    const testApp = await devApp();
    const index = createRouteMetaIndex();
    index.load(testApp.app);
    const entry = index
      .all()
      .find((route) => route.method === 'POST' && route.path === '/v1/dev/mailbox');
    expect(entry?.meta).toMatchObject({
      operationId: 'readDevMailbox',
      auth: 'none',
      rateLimit: 'dev.mailbox',
      public: true,
      clientHeader: 'exempt',
      originCheck: 'exempt',
    });
  });

  it('no-store', async () => {
    const testApp = await devApp();
    const email = 'no-store@example.test';
    await start(testApp, email);
    const response = await readMailbox(testApp, email);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('ok', async () => {
    const testApp = await devApp();
    const email = 'ok@example.test';
    await start(testApp, email);
    const before = await testApp.deps.db.select().from(usageCounters);
    expect(await mailboxCode(testApp, email)).toMatch(/^[0-9]{6}$/);
    // A read of process memory: nothing is written.
    expect(await testApp.deps.db.select().from(usageCounters)).toEqual(before);
    expect(testApp.fakes.mailer.sent).toHaveLength(1);
  });

  it('rejects invalid input', async () => {
    const testApp = await devApp();
    const missing = await testApp.request.post(PATH, {
      ip: freshIp(),
      client: null,
      body: {},
    });
    await expectEnvelope(missing, 'invalid_request');
    await expectEnvelope(await readMailbox(testApp, 'not-an-address'), 'invalid_request');
    const malformed = await testApp.app.request(
      new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': freshIp() },
        body: '{"unterminated',
      },
    );
    await expectEnvelope(malformed, 'invalid_request');
  });

  it('envelope on every error', async () => {
    const testApp = await devApp();
    await expectEnvelope(await readMailbox(testApp, 'nobody@example.test'), 'not_found');
    await expectEnvelope(await readMailbox(testApp, 'x'), 'invalid_request');
  });

  it('rate-limited', async () => {
    const testApp = await devApp();
    const ip = '203.0.113.60';
    for (let n = 1; n <= PER_REPLICA_MINUTE; n += 1) {
      const response = await readMailbox(testApp, 'nobody@example.test', { ip });
      expect(response.status, `read ${String(n)}`).toBe(404);
    }
    const limited = await readMailbox(testApp, 'nobody@example.test', { ip });
    await expectEnvelope(limited, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toMinuteEnd = Math.ceil((Math.ceil(now / MINUTE_MS) * MINUTE_MS - now) / SECOND_MS);
    expect(limited.headers.get('retry-after')).toBe(String(toMinuteEnd));
  });

  it('the address and the code reach no log line', async () => {
    const testApp = await devApp();
    const email = `mailbox.${marker()}@example.test`.toLowerCase();
    await start(testApp, email);
    const code = await mailboxCode(testApp, email);
    await expectEnvelope(
      await readMailbox(testApp, `missing.${marker()}@example.test`.toLowerCase()),
      'not_found',
    );
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(marker());
      expect(line.raw).not.toContain(marker().toLowerCase());
      expect(line.raw).not.toContain('@example.test');
      expect(line.raw).not.toContain(code);
    }
  });
});
