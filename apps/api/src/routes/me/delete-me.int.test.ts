import { sessions, users } from '@citizenrun/db';
import { insertRateCounter, insertUser } from '@citizenrun/db/testing';
import {
  AccountDeletionViewSchema,
  ERROR_CODES,
  ErrorEnvelopeSchema,
  JOB_PAYLOADS,
} from '@citizenrun/shared';
import type { AccountDeletionView, ErrorCode } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-03: TEST-api-ME for DELETE /v1/me, CTL-17 and CTL-35.
const PATH = '/v1/me';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.delete: 5 an hour per user.
const ME_DELETE_LIMIT = 5;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

function now(): Date {
  return testApp.deps.clock.now();
}

function ago(ms: number): Date {
  return new Date(now().getTime() - ms);
}

function deleteMe(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.delete(PATH, options);
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<Envelope> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  expect(body.error.fields).toEqual({});
  return body;
}

async function expectDeletion(response: TestResponse): Promise<AccountDeletionView> {
  expect(response.status).toBe(202);
  return AccountDeletionViewSchema.parse(await response.json());
}

/** A user signed in by bearer just now. */
async function member(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, overrides);
  const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
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

// Email-code sign-in for an address: start, read the captured code, verify.
let nextHost = 1;
async function emailSignIn(email: string): Promise<TestResponse> {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  const started = await testApp.request.post('/v1/auth/email/start', { ip, body: { email } });
  expect(started.status).toBe(200);
  const { pendingToken } = await started.json<{ pendingToken: string }>();
  const code = testApp.fakes.mailer.codeFor(email);
  if (code === null) {
    throw new Error('No code was sent.');
  }
  return testApp.request.post('/v1/auth/email/verify', { ip, body: { pendingToken, code } });
}

describe('DELETE /v1/me', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    const deletion = await expectDeletion(await deleteMe({ auth }));
    const row = await userRow(user.id);
    expect(row.status).toBe('deleting');
    expect(deletion.deletionRequestedAt).toBe(row.deletionRequestedAt?.toISOString());
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await deleteMe(), 'unauthenticated');
    const { auth } = await member();
    const stale = await signIn(testApp.deps.db, (await member()).user, 'bearer', {
      authenticatedAt: ago(16 * MINUTE_MS),
    });
    await expectEnvelope(await deleteMe({ auth: stale }), 'recent_sign_in_required');
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    await expectEnvelope(await deleteMe({ auth: cookie, origin: null }), 'origin_rejected');
    expect((await deleteMe({ auth })).status).toBe(202);
    await expectEnvelope(await deleteMe({ auth }), 'unauthenticated');
  });

  it('requires a session', async () => {
    await expectEnvelope(await deleteMe(), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(5 * MINUTE_MS),
      expiresAt: ago(MINUTE_MS),
    });
    await expectEnvelope(await deleteMe({ auth: expired }), 'unauthenticated');
    const gone = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
    await testApp.deps.db.delete(sessions).where(eq(sessions.userId, user.id));
    await expectEnvelope(await deleteMe({ auth: gone }), 'unauthenticated');
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    await expectEnvelope(
      await deleteMe({
        auth: cookie,
        headers: { Authorization: 'Bearer not-a-session-token-of-anyone-at-all' },
      }),
      'unauthenticated',
    );
    expect((await userRow(user.id)).status).toBe('active');
  });

  it('recent sign-in for export and deletion', async () => {
    const { user } = await member();
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(15 * MINUTE_MS + SECOND_MS),
    });
    await expectEnvelope(await deleteMe({ auth: stale }), 'recent_sign_in_required');
    expect((await userRow(user.id)).status).toBe('active');
    const recent = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(14 * MINUTE_MS + 59 * SECOND_MS),
    });
    await expectDeletion(await deleteMe({ auth: recent }));
    expect((await userRow(user.id)).status).toBe('deleting');
  });

  it('a session authenticated 16 minutes ago is refused', async () => {
    const user = await insertUser(testApp.deps.db);
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(16 * MINUTE_MS),
    });
    await expectEnvelope(await deleteMe({ auth: stale }), 'recent_sign_in_required');
    const row = await userRow(user.id);
    expect(row.status).toBe('active');
    expect(row.deletionRequestedAt).toBeNull();
    expect(await sessionsOf(user.id)).toHaveLength(1);
    expect(await deletionJobsFor(user.id)).toEqual([]);
  });

  it('a fresh session answers 202 with completesBy 24 hours after deletionRequestedAt', async () => {
    const { auth } = await member();
    const deletion = await expectDeletion(await deleteMe({ auth }));
    expect(
      new Date(deletion.completesBy).getTime() - new Date(deletion.deletionRequestedAt).getTime(),
    ).toBe(DAY_MS);
  });

  it('the user is deleting and every session is gone', async () => {
    const { user, auth } = await member();
    const other = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    expect(await sessionsOf(user.id)).toHaveLength(2);
    await expectDeletion(await deleteMe({ auth }));
    expect((await userRow(user.id)).status).toBe('deleting');
    expect(await sessionsOf(user.id)).toEqual([]);
    await expectEnvelope(await testApp.request.get(PATH, { auth }), 'unauthenticated');
    await expectEnvelope(await testApp.request.get(PATH, { auth: other }), 'unauthenticated');
  });

  it('one account.delete job exists with skipDeferral false', async () => {
    const { user, auth } = await member();
    const bystander = await member();
    await expectDeletion(await deleteMe({ auth }));
    expect(await deletionJobsFor(user.id)).toEqual([{ userId: user.id, skipDeferral: false }]);
    expect(await deletionJobsFor(bystander.user.id)).toEqual([]);
  });

  it('a sign-in to the account then answers account_deleting', async () => {
    const { user, auth } = await member({ email: 'leaving@example.test' });
    await expectDeletion(await deleteMe({ auth }));
    const refused = await emailSignIn('leaving@example.test');
    await expectEnvelope(refused, 'account_deleting');
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it('a suspended user can delete', async () => {
    const { user, auth } = await member({
      status: 'suspended',
      suspendedAt: ago(DAY_MS),
      suspendedReason: 'spam',
    });
    await expectDeletion(await deleteMe({ auth }));
    expect((await userRow(user.id)).status).toBe('deleting');
    expect(await deletionJobsFor(user.id)).toHaveLength(1);
  });

  it('a cookie request without Origin answers origin_rejected', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    await expectEnvelope(await deleteMe({ auth: cookie, origin: null }), 'origin_rejected');
    await expectEnvelope(
      await deleteMe({ auth: cookie, origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    await expectEnvelope(
      await deleteMe({ auth: cookie, client: 'ios/1.4.0', origin: testApp.deps.env.PUBLIC_URL }),
      'origin_rejected',
    );
    expect((await userRow(user.id)).status).toBe('active');
    expect(await sessionsOf(user.id)).toHaveLength(1);
    const bearer: TestAuth = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: now(),
    });
    await expectDeletion(await deleteMe({ auth: bearer, origin: null }));
  });

  it('a web request clears the cookie with Max-Age=0', async () => {
    const { user } = await member();
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    const response = await deleteMe({ auth: cookie });
    await expectDeletion(response);
    const setCookie = response.headers.get('set-cookie') ?? '';
    // createTestApp's PUBLIC_URL is https, which selects the __Host- name and Secure.
    expect(setCookie).toMatch(/^__Host-os_session=;/);
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
  });

  it('a phone request sets no cookie', async () => {
    const { auth } = await member();
    const response = await deleteMe({ auth });
    await expectDeletion(response);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('a repeat answers 401', async () => {
    const { user, auth } = await member();
    const first = await expectDeletion(await deleteMe({ auth }));
    await expectEnvelope(await deleteMe({ auth }), 'unauthenticated');
    expect((await userRow(user.id)).deletionRequestedAt?.toISOString()).toBe(
      first.deletionRequestedAt,
    );
    expect(await deletionJobsFor(user.id)).toHaveLength(1);
  });

  it('answers no-store', async () => {
    const { auth } = await member();
    const response = await deleteMe({ auth });
    await expectDeletion(response);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / HOUR_MS) * HOUR_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_delete:1h`,
      windowStart,
      count: ME_DELETE_LIMIT,
    });
    const response = await deleteMe({ auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + HOUR_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(Math.max(1, left)));
    expect((await userRow(user.id)).status).toBe('active');
  });
});
