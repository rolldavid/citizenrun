import { dataExports } from '@citizenrun/db';
import { idAt, insertDataExport, insertRateCounter, insertUser } from '@citizenrun/db/testing';
import {
  DataExportViewSchema,
  ERROR_CODES,
  ErrorEnvelopeSchema,
  JOB_PAYLOADS,
} from '@citizenrun/shared';
import type { DataExportView, ErrorCode } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-04: TEST-api-ME for POST /v1/me/export, the one-a-day rule of TEST-account-export.
const PATH = '/v1/me/export';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.export: 10 an hour per user.
const ME_EXPORT_LIMIT = 10;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;

beforeEach(async () => {
  // The clock stays at the real time (to the second): the daily limit compares it with created_at,
  // which the database sets.
  testApp = await createTestApp();
});

function now(): Date {
  return testApp.deps.clock.now();
}

function ago(ms: number): Date {
  return new Date(now().getTime() - ms);
}

function requestExport(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, { body: {}, ...options });
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

async function expectQueued(response: TestResponse): Promise<DataExportView> {
  expect(response.status).toBe(202);
  const view = DataExportViewSchema.parse(await response.json());
  expect(view.status).toBe('queued');
  expect(view.readyAt).toBeNull();
  expect(view.expiresAt).toBeNull();
  return view;
}

/** A user signed in by bearer just now. */
async function member(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, overrides);
  const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
  return { user, auth };
}

async function exportsOf(userId: string) {
  return testApp.deps.db
    .select()
    .from(dataExports)
    .where(eq(dataExports.userId, userId))
    .orderBy(dataExports.id);
}

async function exportJobs() {
  const jobs = await queuedJobs(testApp.deps.db, 'account.export');
  return jobs.map((job) => JOB_PAYLOADS['account.export'].parse(job.data));
}

describe('POST /v1/me/export', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    const view = await expectQueued(await requestExport({ auth }));
    const [row] = await exportsOf(user.id);
    expect(view.id).toBe(row?.id);
    expect(view.requestedAt).toBe(row?.createdAt.toISOString());
  });

  it('rejects invalid input', async () => {
    const { user, auth } = await member();
    const malformed = await testApp.app.request(
      new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
          'X-OS-Client': 'ios/1.4.0',
        },
        body: '{"',
      },
    );
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Envelope).error.code).toBe('invalid_request');
    expect(await exportsOf(user.id)).toEqual([]);
    // An unknown key is dropped, never refused or stored.
    await expectQueued(await requestExport({ auth, body: { status: 'ready', userId: 'x' } }));
    const [row] = await exportsOf(user.id);
    expect(row?.status).toBe('queued');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await requestExport(), 'unauthenticated');
    const { user, auth } = await member();
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(16 * MINUTE_MS),
    });
    await expectEnvelope(await requestExport({ auth: stale }), 'recent_sign_in_required');
    await expectQueued(await requestExport({ auth }));
    await expectEnvelope(await requestExport({ auth }), 'daily_limit_reached');
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    await expectEnvelope(await requestExport({ auth: cookie, origin: null }), 'origin_rejected');
  });

  it('requires a session', async () => {
    await expectEnvelope(await requestExport(), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(5 * MINUTE_MS),
      expiresAt: ago(MINUTE_MS),
    });
    await expectEnvelope(await requestExport({ auth: expired }), 'unauthenticated');
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    await expectEnvelope(
      await requestExport({
        auth: cookie,
        headers: { Authorization: 'Bearer not-a-session-token-of-anyone-at-all' },
      }),
      'unauthenticated',
    );
    expect(await exportsOf(user.id)).toEqual([]);
  });

  it('checks origin on cookie writes', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    await expectEnvelope(await requestExport({ auth: cookie, origin: null }), 'origin_rejected');
    await expectEnvelope(
      await requestExport({ auth: cookie, origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    await expectEnvelope(
      await requestExport({
        auth: cookie,
        client: 'ios/1.4.0',
        origin: testApp.deps.env.PUBLIC_URL,
      }),
      'origin_rejected',
    );
    expect(await exportsOf(user.id)).toEqual([]);
    const bearer: TestAuth = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: now(),
    });
    await expectQueued(await requestExport({ auth: bearer, origin: null }));
  });

  it('recent sign-in for export and deletion', async () => {
    const user = await insertUser(testApp.deps.db);
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(15 * MINUTE_MS + SECOND_MS),
    });
    await expectEnvelope(await requestExport({ auth: stale }), 'recent_sign_in_required');
    expect(await exportsOf(user.id)).toEqual([]);
    const recent = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(14 * MINUTE_MS + 59 * SECOND_MS),
    });
    await expectQueued(await requestExport({ auth: recent }));
  });

  it('a fresh session answers 202 with a queued row and one account.export job', async () => {
    const { user, auth } = await member();
    const view = await expectQueued(await requestExport({ auth }));
    const rows = await exportsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('queued');
    expect(rows[0]?.objectKey).toBeNull();
    expect(await exportJobs()).toEqual([{ exportId: view.id }]);
  });

  it('a second request answers daily_limit_reached with Retry-After near 86400', async () => {
    const { user, auth } = await member();
    await expectQueued(await requestExport({ auth }));
    const response = await requestExport({ auth });
    await expectEnvelope(response, 'daily_limit_reached');
    const [first] = await exportsOf(user.id);
    if (first === undefined) {
      throw new Error('The first export row is missing.');
    }
    const expected = Math.ceil((first.createdAt.getTime() + DAY_MS - now().getTime()) / SECOND_MS);
    const retryAfter = Number(response.headers.get('retry-after'));
    expect(retryAfter).toBe(expected);
    expect(retryAfter).toBeGreaterThanOrEqual(86_000);
    expect(retryAfter).toBeLessThanOrEqual(86_520);
    expect(await exportsOf(user.id)).toHaveLength(1);
    expect(await exportJobs()).toHaveLength(1);
  });

  it('a request 24 hours and 1 second after the first succeeds', async () => {
    const { user, auth } = await member();
    const before = ago(DAY_MS + SECOND_MS);
    await insertDataExport(testApp.deps.db, {
      userId: user.id,
      id: idAt(before),
      createdAt: before,
    });
    await expectQueued(await requestExport({ auth }));
    expect(await exportsOf(user.id)).toHaveLength(2);
  });

  it('a request counted from a row inside the day is refused until it is a day old', async () => {
    const { user, auth } = await member();
    const before = ago(DAY_MS - 10 * SECOND_MS);
    await insertDataExport(testApp.deps.db, {
      userId: user.id,
      id: idAt(before),
      createdAt: before,
      status: 'failed',
    });
    const response = await requestExport({ auth });
    await expectEnvelope(response, 'daily_limit_reached');
    expect(response.headers.get('retry-after')).toBe('10');
  });

  it('a session authenticated 16 minutes ago is refused', async () => {
    const user = await insertUser(testApp.deps.db);
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(16 * MINUTE_MS),
    });
    await expectEnvelope(await requestExport({ auth: stale }), 'recent_sign_in_required');
    expect(await exportsOf(user.id)).toEqual([]);
    expect(await exportJobs()).toEqual([]);
  });

  it('a suspended user can request', async () => {
    const { user, auth } = await member({
      status: 'suspended',
      suspendedAt: ago(DAY_MS),
      suspendedReason: 'spam',
    });
    await expectQueued(await requestExport({ auth }));
    expect(await exportsOf(user.id)).toHaveLength(1);
  });

  it('logged out answers 401', async () => {
    await expectEnvelope(await requestExport(), 'unauthenticated');
    expect(await exportJobs()).toEqual([]);
  });

  it('acts only on own resources', async () => {
    const other = await member();
    await expectQueued(await requestExport({ auth: other.auth }));
    // Another user's export of today does not count against this user.
    const { user, auth } = await member();
    await expectQueued(await requestExport({ auth }));
    expect(await exportsOf(user.id)).toHaveLength(1);
    expect(await exportsOf(other.user.id)).toHaveLength(1);
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / HOUR_MS) * HOUR_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_export:1h`,
      windowStart,
      count: ME_EXPORT_LIMIT,
    });
    const response = await requestExport({ auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + HOUR_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(Math.max(1, left)));
    expect(await exportsOf(user.id)).toEqual([]);
  });
});
