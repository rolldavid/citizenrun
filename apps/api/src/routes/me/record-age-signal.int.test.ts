import { sessions, users } from '@citizenrun/db';
import { insertRateCounter, insertUser } from '@citizenrun/db/testing';
import {
  AccountDeletionViewSchema,
  ERROR_CODES,
  ErrorEnvelopeSchema,
  JOB_PAYLOADS,
  MeSchema,
} from '@citizenrun/shared';
import type { AccountDeletionView, ErrorCode, Me } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-12: TEST-api-ME for POST /v1/me/age, CTL-71.
const PATH = '/v1/me/age';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.write: 30 a minute per user.
const ME_WRITE_LIMIT = 30;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Five seconds into a minute, so no case crosses a minute window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function now(): Date {
  return testApp.deps.clock.now();
}

function report(body: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, { body, ...options });
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<Envelope> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  return body;
}

async function expectMe(response: TestResponse): Promise<Me> {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return MeSchema.parse(await response.json());
}

async function expectDeletion(response: TestResponse): Promise<AccountDeletionView> {
  expect(response.status).toBe(202);
  return AccountDeletionViewSchema.parse(await response.json());
}

/** A self-declared adult signed in by bearer from iOS. */
async function member(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, overrides);
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function userRow(id: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, id));
  if (row === undefined) {
    throw new Error('The user row is gone.');
  }
  return row;
}

async function sessionsOf(userId: string) {
  return testApp.deps.db.select().from(sessions).where(eq(sessions.userId, userId));
}

async function deletionJobsFor(userId: string) {
  const jobs = await queuedJobs(testApp.deps.db, 'account.delete');
  return jobs
    .map((job) => JOB_PAYLOADS['account.delete'].parse(job.data))
    .filter((payload) => payload.userId === userId);
}

const adult = { result: 'adult', sourceTier: 'confirmed' };

describe('POST /v1/me/age', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    const me = await expectMe(await report(adult, { auth }));
    expect(me.id).toBe(user.id);
    expect(me.age).toEqual({
      method: 'store_signal',
      sourceTier: 'confirmed',
      checkedAt: now().toISOString(),
    });
  });

  it('rejects invalid input', async () => {
    const { user, auth } = await member();
    const cases: [unknown, string, string][] = [
      // A missing enumerated field is reported as invalid_value by the router's issue mapping.
      [{ sourceTier: 'confirmed' }, 'result', 'invalid_value'],
      [{ result: 'under_21', sourceTier: 'confirmed' }, 'result', 'invalid_value'],
      [{ result: 18, sourceTier: 'confirmed' }, 'result', 'invalid_value'],
      [{ result: 'adult' }, 'sourceTier', 'invalid_value'],
      [{ result: 'adult', sourceTier: 'self' }, 'sourceTier', 'invalid_value'],
    ];
    for (const [body, field, code] of cases) {
      const envelope = await expectEnvelope(await report(body, { auth }), 'invalid_request');
      expect(envelope.error.fields[field], field).toBe(code);
    }
    const malformed = await testApp.app.request(
      new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
          'X-OS-Client': 'ios/1.4.0',
        },
        body: '{"result":',
      },
    );
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Envelope).error.code).toBe('invalid_request');
    const row = await userRow(user.id);
    expect(row.ageMethod).toBe('self_declared');
    // An unknown key is dropped: a raw signal or a birth year is never read or stored.
    await expectMe(await report({ ...adult, birthYear: 1990, rawSignal: 'x' }, { auth }));
    expect((await userRow(user.id)).ageMethod).toBe('store_signal');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await report(adult), 'unauthenticated');
    const { auth } = await member();
    await expectEnvelope(
      await report({ result: 'x', sourceTier: 'x' }, { auth }),
      'invalid_request',
    );
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(await report(adult, { auth: cookie }), 'invalid_request');
  });

  it('requires a session', async () => {
    await expectEnvelope(await report(adult), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now().getTime() - 100 * DAY_MS),
      expiresAt: new Date(now().getTime() - MINUTE_MS),
    });
    await expectEnvelope(await report(adult, { auth: expired }), 'unauthenticated');
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await report(adult, {
        auth: cookie,
        headers: { Authorization: 'Bearer not-a-session-token-of-anyone-at-all' },
      }),
      'unauthenticated',
    );
    expect((await userRow(user.id)).ageMethod).toBe('self_declared');
  });

  it('checks origin on cookie writes', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(await report(adult, { auth: cookie, origin: null }), 'origin_rejected');
    await expectEnvelope(
      await report(adult, { auth: cookie, origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    await expectEnvelope(
      await report(adult, {
        auth: cookie,
        client: 'ios/1.4.0',
        origin: testApp.deps.env.PUBLIC_URL,
      }),
      'origin_rejected',
    );
    expect((await userRow(user.id)).ageMethod).toBe('self_declared');
    const bearer: TestAuth = await signIn(testApp.deps.db, user, 'bearer');
    await expectMe(await report(adult, { auth: bearer, origin: null }));
  });

  it('a self_declared user reporting adult confirmed is stored as store_signal confirmed', async () => {
    const { user, auth } = await member({
      ageMethod: 'self_declared',
      ageSourceTier: 'self',
      ageCheckedAt: new Date(now().getTime() - 30 * DAY_MS),
    });
    await expectMe(await report(adult, { auth }));
    const row = await userRow(user.id);
    expect(row.ageMethod).toBe('store_signal');
    expect(row.ageResult).toBe('adult');
    expect(row.ageSourceTier).toBe('confirmed');
    expect(row.ageCheckedAt?.toISOString()).toBe(now().toISOString());
    expect(row.status).toBe('active');
    expect(await sessionsOf(user.id)).toHaveLength(1);
  });

  it('a repeated adult signal refreshes age_checked_at', async () => {
    const { user, auth } = await member();
    await expectMe(await report({ result: 'adult', sourceTier: 'declared' }, { auth }));
    testApp.deps.clock.advance(10 * SECOND_MS);
    const me = await expectMe(await report({ result: 'adult', sourceTier: 'declared' }, { auth }));
    expect(me.age?.checkedAt).toBe(now().toISOString());
    expect((await userRow(user.id)).ageSourceTier).toBe('declared');
  });

  it('an under-18 signal suspends and starts deletion', async () => {
    const { user, auth } = await member();
    await signIn(testApp.deps.db, user, 'bearer');
    const deletion = await expectDeletion(
      await report({ result: 'under_18', sourceTier: 'declared' }, { auth }),
    );
    const row = await userRow(user.id);
    expect(row.status).toBe('deleting');
    expect(row.suspendedReason).toBe('under_18');
    expect(row.suspendedAt?.toISOString()).toBe(now().toISOString());
    expect(deletion.deletionRequestedAt).toBe(row.deletionRequestedAt?.toISOString());
    expect(
      new Date(deletion.completesBy).getTime() - new Date(deletion.deletionRequestedAt).getTime(),
    ).toBe(DAY_MS);
    expect(await sessionsOf(user.id)).toEqual([]);
    expect(await deletionJobsFor(user.id)).toEqual([{ userId: user.id, skipDeferral: false }]);
    // The age record is left as it was: nothing of the minor signal is stored.
    expect(row.ageMethod).toBe('self_declared');
    expect(row.ageResult).toBe('adult');
  });

  it('under_13 enqueues the deletion job with skipDeferral true', async () => {
    const { user, auth } = await member();
    await expectDeletion(await report({ result: 'under_13', sourceTier: 'confirmed' }, { auth }));
    const row = await userRow(user.id);
    expect(row.status).toBe('deleting');
    expect(row.suspendedReason).toBe('under_18');
    expect(await deletionJobsFor(user.id)).toEqual([{ userId: user.id, skipDeferral: true }]);
  });

  it('a web client answers not_allowed on result', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    for (const result of ['adult', 'under_18', 'under_13']) {
      const envelope = await expectEnvelope(
        await report({ result, sourceTier: 'confirmed' }, { auth: cookie }),
        'invalid_request',
      );
      expect(envelope.error.fields).toEqual({ result: 'not_allowed' });
    }
    // A web session over a bearer token is refused the same way.
    const webBearer = await signIn(testApp.deps.db, user, 'bearer');
    await expectEnvelope(
      await report(adult, { auth: webBearer, client: 'web/1.4.0', origin: null }),
      'invalid_request',
    );
    const row = await userRow(user.id);
    expect(row.ageMethod).toBe('self_declared');
    expect(row.status).toBe('active');
    expect(await deletionJobsFor(user.id)).toEqual([]);
  });

  it('the minor branch logs account.age_minor with the band and nothing else of the signal', async () => {
    const { user, auth } = await member();
    await expectDeletion(await report({ result: 'under_13', sourceTier: 'declared' }, { auth }));
    const lines = testApp.logs.filter((line) => line.parsed['event'] === 'account.age_minor');
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line?.parsed['level']).toBe('warn');
    expect(line?.parsed['userId']).toBe(user.id);
    expect(line?.parsed['band']).toBe('under_13');
    expect(Object.keys(line?.parsed ?? {}).sort()).toEqual(
      ['band', 'event', 'level', 'service', 'time', 'userId'].sort(),
    );
    // The source tier of the signal appears in no line.
    for (const each of testApp.logs) {
      expect(each.raw).not.toContain('declared');
    }
  });

  it('an adult signal writes no log line of its own', async () => {
    const { auth } = await member();
    await expectMe(await report(adult, { auth }));
    expect(testApp.logs.filter((line) => line.parsed['event'] !== 'request.done')).toEqual([]);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain('confirmed');
    }
  });

  it('a repeat after a minor result answers 401', async () => {
    const { user, auth } = await member();
    await expectDeletion(await report({ result: 'under_18', sourceTier: 'declared' }, { auth }));
    await expectEnvelope(
      await report({ result: 'under_18', sourceTier: 'declared' }, { auth }),
      'unauthenticated',
    );
    expect(await deletionJobsFor(user.id)).toHaveLength(1);
  });

  it('a suspended user can report', async () => {
    const { user, auth } = await member({
      status: 'suspended',
      suspendedAt: new Date(now().getTime() - DAY_MS),
      suspendedReason: 'spam',
    });
    await expectMe(await report(adult, { auth }));
    expect((await userRow(user.id)).ageMethod).toBe('store_signal');
    await expectDeletion(await report({ result: 'under_18', sourceTier: 'declared' }, { auth }));
    const row = await userRow(user.id);
    expect(row.status).toBe('deleting');
    expect(row.suspendedReason).toBe('under_18');
  });

  it('a minor result clears the session cookie', async () => {
    const { auth } = await member();
    const response = await report({ result: 'under_18', sourceTier: 'declared' }, { auth });
    await expectDeletion(response);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_write:1m`,
      windowStart,
      count: ME_WRITE_LIMIT,
    });
    const response = await report({ result: 'under_18', sourceTier: 'declared' }, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect((await userRow(user.id)).status).toBe('active');
  });
});
