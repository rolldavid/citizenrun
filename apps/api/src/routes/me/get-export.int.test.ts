import { idAt, insertDataExport, insertRateCounter, insertUser } from '@citizenrun/db/testing';
import { DataExportStatusSchema, ERROR_CODES, ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { DataExportStatus, ErrorCode } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-05: TEST-api-ME for GET /v1/me/export.
const PATH = '/v1/me/export';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.read: 120 a minute per user.
const ME_READ_LIMIT = 120;

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

function ago(ms: number): Date {
  return new Date(now().getTime() - ms);
}

function getExport(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.get(PATH, options);
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

async function expectStatus(response: TestResponse): Promise<DataExportStatus> {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return DataExportStatusSchema.parse(await response.json());
}

async function member() {
  const user = await insertUser(testApp.deps.db);
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

/** An export row of `userId` requested at `at`. */
function exportAt(
  userId: string,
  at: Date,
  overrides: Parameters<typeof insertDataExport>[1] = {},
) {
  return insertDataExport(testApp.deps.db, { userId, id: idAt(at), createdAt: at, ...overrides });
}

describe('GET /v1/me/export', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    const requested = ago(HOUR_MS);
    const readyAt = ago(30 * MINUTE_MS);
    const row = await exportAt(user.id, requested, { status: 'ready', readyAt });
    const status = await expectStatus(await getExport({ auth }));
    expect(status.export).toEqual({
      id: row.id,
      status: 'ready',
      requestedAt: requested.toISOString(),
      readyAt: readyAt.toISOString(),
      expiresAt: new Date(readyAt.getTime() + DAY_MS).toISOString(),
    });
    expect(status.nextRequestAt).toBe(new Date(requested.getTime() + DAY_MS).toISOString());
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await getExport(), 'unauthenticated');
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_read:1m`,
      windowStart,
      count: ME_READ_LIMIT,
    });
    await expectEnvelope(await getExport({ auth }), 'rate_limited');
  });

  it('requires a session', async () => {
    await expectEnvelope(await getExport(), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(DAY_MS),
      expiresAt: ago(MINUTE_MS),
    });
    await expectEnvelope(await getExport({ auth: expired }), 'unauthenticated');
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await getExport({
        auth: cookie,
        headers: { Authorization: 'Bearer not-a-session-token-of-anyone-at-all' },
      }),
      'unauthenticated',
    );
    expect((await getExport({ auth: cookie })).status).toBe(200);
  });

  it('needs no recent sign-in', async () => {
    const user = await insertUser(testApp.deps.db);
    const old = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(30 * DAY_MS),
    });
    await expectStatus(await getExport({ auth: old }));
  });

  it('no row gives export null and nextRequestAt null', async () => {
    const { auth } = await member();
    expect(await expectStatus(await getExport({ auth }))).toEqual({
      export: null,
      nextRequestAt: null,
    });
  });

  it('a queued row is reported with nextRequestAt 24 hours after it', async () => {
    const { user, auth } = await member();
    const requested = ago(2 * HOUR_MS);
    const row = await exportAt(user.id, requested);
    expect(await expectStatus(await getExport({ auth }))).toEqual({
      export: {
        id: row.id,
        status: 'queued',
        requestedAt: requested.toISOString(),
        readyAt: null,
        expiresAt: null,
      },
      nextRequestAt: new Date(requested.getTime() + DAY_MS).toISOString(),
    });
  });

  it('the newest row is reported and nextRequestAt is null once a day has passed', async () => {
    const { user, auth } = await member();
    await exportAt(user.id, ago(3 * DAY_MS), { status: 'failed' });
    const newest = await exportAt(user.id, ago(DAY_MS + MINUTE_MS), { status: 'failed' });
    const status = await expectStatus(await getExport({ auth }));
    expect(status.export?.id).toBe(newest.id);
    expect(status.export?.status).toBe('failed');
    expect(status.nextRequestAt).toBeNull();
  });

  it('a ready row past expires_at is reported expired', async () => {
    const { user, auth } = await member();
    const readyAt = ago(DAY_MS + HOUR_MS);
    await exportAt(user.id, ago(DAY_MS + 2 * HOUR_MS), { status: 'ready', readyAt });
    const status = await expectStatus(await getExport({ auth }));
    expect(status.export?.status).toBe('expired');
    expect(status.export?.expiresAt).toBe(new Date(readyAt.getTime() + DAY_MS).toISOString());
  });

  it('a ready row exactly at expires_at is reported expired', async () => {
    const { user, auth } = await member();
    await exportAt(user.id, ago(DAY_MS + HOUR_MS), {
      status: 'ready',
      readyAt: ago(DAY_MS),
      expiresAt: now(),
    });
    expect((await expectStatus(await getExport({ auth }))).export?.status).toBe('expired');
  });

  it("another user's row is never returned", async () => {
    const other = await member();
    await exportAt(other.user.id, ago(HOUR_MS), { status: 'ready', readyAt: ago(MINUTE_MS) });
    const { auth } = await member();
    expect(await expectStatus(await getExport({ auth }))).toEqual({
      export: null,
      nextRequestAt: null,
    });
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_read:1m`,
      windowStart,
      count: ME_READ_LIMIT,
    });
    const response = await getExport({ auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });
});
