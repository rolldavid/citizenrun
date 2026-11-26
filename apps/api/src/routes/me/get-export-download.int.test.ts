import {
  fetchPresignedGet,
  idAt,
  insertDataExport,
  insertRateCounter,
  insertUser,
  putTestObject,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, ExportDownloadSchema } from '@citizenrun/shared';
import type { ErrorCode, ExportDownload } from '@citizenrun/shared';
import { exportKey } from '@citizenrun/shared/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-06 (D-466): TEST-api-ME for GET /v1/me/export/download, TEST-account-export
// `authenticated download only`.
const PATH = '/v1/me/export/download';
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
  // The clock stays at the real time (to the second): the local store checks the link's expiry
  // against its own clock.
  testApp = await createTestApp();
});

function now(): Date {
  return testApp.deps.clock.now();
}

function ago(ms: number): Date {
  return new Date(now().getTime() - ms);
}

function download(options: TestRequestOptions = {}): Promise<TestResponse> {
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

async function expectLink(response: TestResponse): Promise<ExportDownload> {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return ExportDownloadSchema.parse(await response.json());
}

/** A user signed in by bearer just now. */
async function member() {
  const user = await insertUser(testApp.deps.db);
  const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
  return { user, auth };
}

/** A ready export of `userId` whose file holds `bytes` in the media bucket. */
async function readyExport(userId: string, bytes: Uint8Array, readyAt: Date = ago(HOUR_MS)) {
  const requested = new Date(readyAt.getTime() - 10 * MINUTE_MS);
  const row = await insertDataExport(testApp.deps.db, {
    userId,
    id: idAt(requested),
    createdAt: requested,
    status: 'ready',
    readyAt,
  });
  const key = exportKey(userId, row.id);
  expect(row.objectKey).toBe(key);
  await putTestObject('media', key, bytes, 'application/json');
  return row;
}

function fileBytes(label: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ fixture: label }));
}

describe('GET /v1/me/export/download', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    await readyExport(user.id, fileBytes('ok'));
    const link = await expectLink(await download({ auth }));
    expect(link.expiresAt).toBe(new Date(now().getTime() + 300 * SECOND_MS).toISOString());
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await download(), 'unauthenticated');
    const { user, auth } = await member();
    await expectEnvelope(await download({ auth }), 'not_found');
    await insertDataExport(testApp.deps.db, { userId: user.id });
    await expectEnvelope(await download({ auth }), 'export_not_ready');
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(16 * MINUTE_MS),
    });
    await expectEnvelope(await download({ auth: stale }), 'recent_sign_in_required');
  });

  it('requires a session', async () => {
    await expectEnvelope(await download(), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    await readyExport(user.id, fileBytes('session'));
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(5 * MINUTE_MS),
      expiresAt: ago(MINUTE_MS),
    });
    await expectEnvelope(await download({ auth: expired }), 'unauthenticated');
    const cookie = await signIn(testApp.deps.db, user, 'cookie', { authenticatedAt: now() });
    await expectEnvelope(
      await download({
        auth: cookie,
        headers: { Authorization: 'Bearer not-a-session-token-of-anyone-at-all' },
      }),
      'unauthenticated',
    );
    await expectLink(await download({ auth: cookie }));
  });

  it('recent sign-in for export and deletion', async () => {
    const user = await insertUser(testApp.deps.db);
    await readyExport(user.id, fileBytes('recent'));
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(15 * MINUTE_MS + SECOND_MS),
    });
    await expectEnvelope(await download({ auth: stale }), 'recent_sign_in_required');
    const recent = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(14 * MINUTE_MS + 59 * SECOND_MS),
    });
    await expectLink(await download({ auth: recent }));
  });

  it('a ready export gives a link that downloads the file within 300 seconds', async () => {
    const { user, auth } = await member();
    const bytes = fileBytes('download');
    const readyAt = ago(2 * HOUR_MS);
    await readyExport(user.id, bytes, readyAt);
    const link = await expectLink(await download({ auth }));
    const url = new URL(link.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    const fetched = await fetchPresignedGet(link.url);
    expect(fetched.status).toBe(200);
    expect(Array.from(fetched.body)).toEqual(Array.from(bytes));
    const date = readyAt.toISOString().slice(0, 10);
    expect(fetched.headers.get('content-disposition')).toContain(`export-${date}.json`);
  });

  it('each call signs a new link', async () => {
    const { user, auth } = await member();
    await readyExport(user.id, fileBytes('twice'));
    const first = await expectLink(await download({ auth }));
    testApp.deps.clock.advance(SECOND_MS);
    const second = await expectLink(await download({ auth }));
    expect(second.url).not.toBe(first.url);
  });

  it('a queued export answers export_not_ready', async () => {
    const { user, auth } = await member();
    // An older ready export does not make the newer queued one downloadable.
    await readyExport(user.id, fileBytes('older'), ago(3 * DAY_MS));
    await insertDataExport(testApp.deps.db, {
      userId: user.id,
      id: idAt(ago(MINUTE_MS)),
      createdAt: ago(MINUTE_MS),
    });
    await expectEnvelope(await download({ auth }), 'export_not_ready');
  });

  it('an expired or failed export answers not_found', async () => {
    const reported = await member();
    await readyExport(reported.user.id, fileBytes('past'), ago(DAY_MS + MINUTE_MS));
    await expectEnvelope(await download({ auth: reported.auth }), 'not_found');

    const stored = await member();
    await insertDataExport(testApp.deps.db, { userId: stored.user.id, status: 'expired' });
    await expectEnvelope(await download({ auth: stored.auth }), 'not_found');

    const failed = await member();
    await insertDataExport(testApp.deps.db, { userId: failed.user.id, status: 'failed' });
    await expectEnvelope(await download({ auth: failed.auth }), 'not_found');

    const none = await member();
    await expectEnvelope(await download({ auth: none.auth }), 'not_found');
  });

  it('a session authenticated 16 minutes ago is refused', async () => {
    const user = await insertUser(testApp.deps.db);
    await readyExport(user.id, fileBytes('stale'));
    const stale = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: ago(16 * MINUTE_MS),
    });
    await expectEnvelope(await download({ auth: stale }), 'recent_sign_in_required');
  });

  it("another user's export is never reachable", async () => {
    const other = await member();
    await readyExport(other.user.id, fileBytes('theirs'));
    const { auth } = await member();
    const own = await expectEnvelope(await download({ auth }), 'not_found');
    // The same answer as for a user with no export at all.
    const none = await member();
    const empty = await expectEnvelope(await download({ auth: none.auth }), 'not_found');
    expect(own).toEqual(empty);
  });

  it('acts only on own resources', async () => {
    const owner = await member();
    await readyExport(owner.user.id, fileBytes('owner'));
    const { user, auth } = await member();
    await insertDataExport(testApp.deps.db, { userId: user.id });
    await expectEnvelope(await download({ auth }), 'export_not_ready');
    const link = await expectLink(await download({ auth: owner.auth }));
    expect(new URL(link.url).pathname).toContain(owner.user.id);
    expect(new URL(link.url).pathname).not.toContain(user.id);
  });

  it('the link appears in no log line', async () => {
    const { user, auth } = await member();
    await readyExport(user.id, fileBytes('logs'));
    const link = await expectLink(await download({ auth }));
    const signature = new URL(link.url).searchParams.get('X-Amz-Signature') ?? '';
    expect(signature).not.toBe('');
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(signature);
      expect(line.raw).not.toContain('exports/');
    }
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    await readyExport(user.id, fileBytes('limited'));
    const windowStart = new Date(Math.floor(now().getTime() / HOUR_MS) * HOUR_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_export:1h`,
      windowStart,
      count: ME_EXPORT_LIMIT,
    });
    const response = await download({ auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + HOUR_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(Math.max(1, left)));
  });
});
