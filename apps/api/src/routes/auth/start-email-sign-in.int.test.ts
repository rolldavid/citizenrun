import { dayPeriod, emailCodes, rateLimits, usageCounters } from '@citizenrun/db';
import { insertUsageCounter, insertUser } from '@citizenrun/db/testing';
import { LEGAL_VERSIONS } from '@citizenrun/shared';
import { emailCodeHash, newEmailCode, sha256Hex } from '@citizenrun/shared/crypto';
import { marker } from '@citizenrun/shared/testing';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addressHashOf } from '../../middleware/rate-limit.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-AUTH-01: TEST-api-AUTH, TEST-auth-email and the cases of CTL-12, CTL-21 and CTL-42.
const START = '/v1/auth/email/start';
const VERIFY = '/v1/auth/email/verify';
const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const SIGNUP = {
  age: { method: 'self_declared', sourceTier: 'self' },
  agreements: {
    termsVersion: LEGAL_VERSIONS.terms,
    contentPolicyVersion: LEGAL_VERSIONS.content_policy,
    privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
  },
  aiScreening: true,
};
const STANDARD_LOG_KEYS = ['event', 'level', 'service', 'time'];

type StartResult = { pendingToken: string; expiresAt: string; resendAvailableAt: string };
type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

// Every request comes from its own address unless a case names one, so no case nears the
// ten-an-hour address limit by accident.
let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // A fixed instant a few minutes into an hour, so no case crosses an hour or a day window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + 5 * 60_000));
});

function start(
  email: string,
  options: TestRequestOptions & { pendingToken?: string } = {},
): Promise<TestResponse> {
  const { pendingToken, ...rest } = options;
  return testApp.request.post(START, {
    ip: freshIp(),
    body: pendingToken === undefined ? { email } : { email, pendingToken },
    ...rest,
  });
}

function verify(pendingToken: string, code: string): Promise<TestResponse> {
  return testApp.request.post(VERIFY, {
    ip: freshIp(),
    body: { pendingToken, code, signup: SIGNUP },
  });
}

async function expectError(
  response: TestResponse,
  status: number,
  code: string,
): Promise<Envelope> {
  expect(response.status).toBe(status);
  const body = await response.json<Envelope>();
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'fields', 'message']);
  expect(body.error.code).toBe(code);
  expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  return body;
}

async function startOk(email: string, options: Parameters<typeof start>[1] = {}) {
  const response = await start(email, options);
  expect(response.status).toBe(200);
  return response.json<StartResult>();
}

function codeOf(email: string): string {
  const code = testApp.fakes.mailer.codeFor(email);
  if (code === null) {
    throw new Error('No code was sent to the address.');
  }
  return code;
}

function otherThan(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

async function challengeRows(email?: string) {
  const query = testApp.deps.db.select().from(emailCodes);
  return email === undefined ? query : query.where(eq(emailCodes.email, email));
}

async function counter(name: string): Promise<number | null> {
  const [row] = await testApp.deps.db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(eq(usageCounters.name, name));
  return row?.count ?? null;
}

describe('POST /v1/auth/email/start', () => {
  it('sends a six-digit code', async () => {
    const email = 'person@example.test';
    const result = await startOk(email);
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'pendingToken', 'resendAvailableAt']);
    expect(result.pendingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const now = testApp.deps.clock.now().getTime();
    expect(result.expiresAt).toBe(new Date(now + 10 * 60_000).toISOString());
    expect(result.resendAvailableAt).toBe(new Date(now + 30 * SECOND_MS).toISOString());
    const code = codeOf(email);
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(testApp.fakes.mailer.sent).toHaveLength(1);
    const rows = await challengeRows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.email).toBe(email);
    expect(row?.codeHash).not.toBe(code);
    expect(row?.codeHash).not.toBe(sha256Hex(code));
    expect(row?.codeHash).toBe(emailCodeHash(testApp.deps.keyRing, email, code));
    expect(row?.pendingTokenHash).toBe(sha256Hex(result.pendingToken));
    expect(row?.attempts).toBe(0);
    expect(row?.sendCount).toBe(1);
  });

  it('same answer for known and unknown emails', async () => {
    const user = await insertUser(testApp.deps.db, { email: 'known@example.test' });
    const known = await start(user.email ?? '');
    const unknown = await start('unknown@example.test');
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    const knownBody = await known.json<Record<string, unknown>>();
    const unknownBody = await unknown.json<Record<string, unknown>>();
    expect(Object.keys(knownBody).sort()).toEqual(Object.keys(unknownBody).sort());
    for (const key of Object.keys(knownBody)) {
      expect(typeof knownBody[key]).toBe(typeof unknownBody[key]);
    }
  });

  it('resend within 30 seconds is refused', async () => {
    const email = 'resend@example.test';
    const first = await startOk(email);
    const firstCode = codeOf(email);
    const [before] = await challengeRows();
    testApp.deps.clock.advance(10 * SECOND_MS);
    const early = await start(email, { pendingToken: first.pendingToken });
    await expectError(early, 429, 'rate_limited');
    expect(early.headers.get('retry-after')).toBe('20');
    testApp.deps.clock.advance(21 * SECOND_MS);
    const resent = await startOk(email, { pendingToken: first.pendingToken });
    expect(resent.pendingToken).toBe(first.pendingToken);
    const rows = await challengeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before?.id);
    expect(rows[0]?.sendCount).toBe(2);
    expect(rows[0]?.codeHash).not.toBe(before?.codeHash);
    const secondCode = codeOf(email);
    if (secondCode !== firstCode) {
      await expectError(await verify(first.pendingToken, firstCode), 422, 'code_invalid');
    }
    const done = await verify(first.pendingToken, secondCode);
    expect(done.status).toBe(200);
  });

  it('resend keeps the attempt count', async () => {
    const email = 'attempts@example.test';
    const first = await startOk(email);
    const wrong = otherThan(codeOf(email));
    for (let n = 0; n < 3; n += 1) {
      await expectError(await verify(first.pendingToken, wrong), 422, 'code_invalid');
    }
    testApp.deps.clock.advance(31 * SECOND_MS);
    await startOk(email, { pendingToken: first.pendingToken });
    const [row] = await challengeRows();
    expect(row?.attempts).toBe(3);
    expect(row?.sendCount).toBe(2);
    const stillWrong = otherThan(codeOf(email));
    await expectError(await verify(first.pendingToken, stillWrong), 422, 'code_invalid');
    await expectError(await verify(first.pendingToken, stillWrong), 422, 'code_attempts_exhausted');
    expect(await challengeRows()).toHaveLength(0);
  });

  it('three codes an hour per email', async () => {
    const email = 'hourly@example.test';
    await startOk(email);
    const second = await startOk(email);
    const signedIn = await verify(second.pendingToken, codeOf(email));
    expect(signedIn.status).toBe(200);
    expect(await challengeRows()).toHaveLength(1);
    await startOk(email);
    const fourth = await start(email);
    await expectError(fourth, 429, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toHourEnd = Math.ceil((Math.ceil(now / HOUR_MS) * HOUR_MS - now) / SECOND_MS);
    expect(fourth.headers.get('retry-after')).toBe(String(toHourEnd));
    expect(testApp.fakes.mailer.sent).toHaveLength(3);
  });

  it('ten an hour per address', async () => {
    for (let n = 1; n <= 10; n += 1) {
      const response = await start(`address${String(n)}@example.test`, { ip: '203.0.113.7' });
      expect(response.status, `start ${String(n)}`).toBe(200);
    }
    const eleventh = await start('address11@example.test', { ip: '203.0.113.7' });
    await expectError(eleventh, 429, 'rate_limited');
    const other = await start('address12@example.test', { ip: '203.0.113.8' });
    expect(other.status).toBe(200);
  });

  it('keys never hold an address', async () => {
    const starts = ['203.0.113.7', '203.0.113.7', '203.0.113.8'];
    for (const [index, ip] of starts.entries()) {
      await startOk(`keys${String(index)}@example.test`, { ip });
    }
    const keys = (await testApp.deps.db.select({ key: rateLimits.key }).from(rateLimits)).map(
      (row) => row.key,
    );
    expect(keys.some((key) => key.includes('203.0.113'))).toBe(false);
    const now = testApp.deps.clock.now();
    const ring = testApp.deps.keyRing;
    const ipKeys = keys.filter((key) => key.startsWith('ip:')).sort();
    expect(ipKeys).toEqual(
      [
        `ip:${addressHashOf(ring, '203.0.113.7', now)}:auth_code:1h`,
        `ip:${addressHashOf(ring, '203.0.113.8', now)}:auth_code:1h`,
      ].sort(),
    );
    expect(keys.filter((key) => key.startsWith('em:'))).toHaveLength(3);
    expect(keys.every((key) => key.startsWith('ip:') || key.startsWith('em:'))).toBe(true);
  });

  it('bounced address', async () => {
    const user = await insertUser(testApp.deps.db, {
      email: 'bounced@example.test',
      emailStatus: 'bounced',
    });
    await expectError(await start(user.email ?? ''), 422, 'email_undeliverable');
    expect(await challengeRows()).toHaveLength(0);
    expect(testApp.fakes.mailer.sent).toHaveLength(0);
    expect(await testApp.deps.db.select().from(usageCounters)).toEqual([]);
    const keys = await testApp.deps.db.select({ key: rateLimits.key }).from(rateLimits);
    expect(keys.filter((row) => row.key.startsWith('em:'))).toEqual([]);
  });

  it('daily ceiling on sign-in email', async () => {
    const period = dayPeriod(testApp.deps.clock.now());
    await insertUsageCounter(testApp.deps.db, { name: 'email.signin.day', period, count: 2000 });
    await expectError(await start('paused@example.test'), 503, 'email_signin_paused');
    expect(testApp.fakes.mailer.sent).toHaveLength(0);
    expect(await challengeRows()).toHaveLength(0);

    await testApp.deps.db
      .update(usageCounters)
      .set({ count: 999 })
      .where(eq(usageCounters.name, 'email.signin.day'));
    await startOk('thousandth@example.test');
    const alerts = await queuedJobs(testApp.deps.db, 'ops.alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.data).toEqual({
      kind: 'cost_projection',
      values: { line: 'signin_ceiling', value: 1000, projected: 1000, threshold: 1000 },
    });
    expect(alerts[0]?.singletonKey).toBe('cost:signin_ceiling');
    const names = await testApp.deps.db.execute<{ name: string }>(
      sql`select name from pgboss.job order by name`,
      'objects',
    );
    expect(names.map((row) => row.name)).toEqual(['ops.alert']);

    await startOk('after@example.test');
    expect(await counter('email.signin.day')).toBe(1001);
    expect(await queuedJobs(testApp.deps.db, 'ops.alert')).toHaveLength(1);
  });

  it('a mailer failure leaves no new challenge', async () => {
    const email = 'failing@example.test';
    testApp.fakes.mailer.failNext('5xx');
    await expectError(await start(email), 503, 'unavailable');
    expect(await challengeRows()).toHaveLength(0);
    const failed = testApp.logs.filter((line) => line.parsed['event'] === 'auth.code_send_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.parsed['level']).toBe('warn');
    expect(Object.keys(failed[0]?.parsed ?? {}).sort()).toEqual(STANDARD_LOG_KEYS);

    const first = await startOk(email);
    testApp.deps.clock.advance(31 * SECOND_MS);
    testApp.fakes.mailer.failNext('5xx');
    await expectError(await start(email, { pendingToken: first.pendingToken }), 503, 'unavailable');
    const rows = await challengeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pendingTokenHash).toBe(sha256Hex(first.pendingToken));
  });

  it('idempotency key and counters', async () => {
    const email = 'counted@example.test';
    const first = await startOk(email);
    const [row] = await challengeRows();
    expect(testApp.fakes.mailer.sent.map((message) => message.idempotencyKey)).toEqual([
      `signin-${row?.id ?? ''}-1`,
    ]);
    expect(await counter('email.day')).toBe(1);
    expect(await counter('email.month')).toBe(1);
    expect(await counter('email.signin.day')).toBe(1);
    testApp.deps.clock.advance(31 * SECOND_MS);
    await startOk(email, { pendingToken: first.pendingToken });
    expect(testApp.fakes.mailer.sent.map((message) => message.idempotencyKey)).toEqual([
      `signin-${row?.id ?? ''}-1`,
      `signin-${row?.id ?? ''}-2`,
    ]);
    expect(await counter('email.day')).toBe(2);
    expect(await counter('email.signin.day')).toBe(2);
  });

  it('review account', async () => {
    const reviewCode = newEmailCode();
    testApp = await createTestApp({
      env: { REVIEW_SIGNIN_EMAILS: 'review@example.test', REVIEW_SIGNIN_CODE: reviewCode },
    });
    const first = await startOk('Review@Example.test');
    expect(testApp.fakes.mailer.sent).toHaveLength(0);
    expect(await counter('email.signin.day')).toBeNull();
    const [row] = await challengeRows();
    expect(row?.email).toBe('review@example.test');
    const signedIn = await verify(first.pendingToken, reviewCode);
    expect(signedIn.status).toBe(200);
    await startOk('review@example.test');
    await startOk('review@example.test');
    await expectError(await start('review@example.test'), 429, 'rate_limited');
    expect(testApp.fakes.mailer.sent).toHaveLength(0);
  });

  it('a malformed email', async () => {
    const malformed = await expectError(await start('not-an-email'), 400, 'invalid_request');
    expect(malformed.error.fields).toEqual({ email: 'invalid_format' });
    const longest = `${'a'.repeat(242)}@example.test`;
    expect(longest).toHaveLength(255);
    const tooLong = await expectError(await start(longest), 400, 'invalid_request');
    expect(tooLong.error.fields).toEqual({ email: 'too_long' });
    const badToken = await expectError(
      await start('token@example.test', { pendingToken: 'short' }),
      400,
      'invalid_request',
    );
    expect(badToken.error.fields).toEqual({ pendingToken: 'invalid_format' });
    expect(testApp.fakes.mailer.sent).toHaveLength(0);
    await startOk('  Person@Example.TEST ');
    const rows = await challengeRows();
    expect(rows.map((row) => row.email)).toEqual(['person@example.test']);
    expect(codeOf('person@example.test')).toMatch(/^[0-9]{6}$/);
  });

  it('a web request without Origin is refused', async () => {
    await expectError(
      await start('web@example.test', { client: 'web/1.4.0', origin: null }),
      403,
      'origin_rejected',
    );
    expect(testApp.fakes.mailer.sent).toHaveLength(0);
    const phone = await start('phone@example.test', { client: 'ios/1.4.0', origin: null });
    expect(phone.status).toBe(200);
  });

  it('a marker email never reaches a log line', async () => {
    const email = `person.${marker()}@example.test`;
    const result = await startOk(email);
    const code = codeOf(email.toLowerCase());
    const signedIn = await verify(result.pendingToken, code);
    expect(signedIn.status).toBe(200);
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(marker());
      expect(line.raw).not.toContain(marker().toLowerCase());
      expect(line.raw).not.toContain('@example.test');
      expect(line.raw).not.toContain(result.pendingToken);
      expect(line.raw).not.toContain(code);
    }
  });
});
