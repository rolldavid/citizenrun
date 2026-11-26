import { uploads } from '@citizenrun/db';
import {
  getTestObject,
  idAt,
  insertRateCounter,
  insertUpload,
  insertUser,
  registerScanValue,
  uploadWithPolicy,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, UploadTicketSchema } from '@citizenrun/shared';
import type { ErrorCode, UploadTicket } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import { withWritesHeld } from '../../testing/held-writes.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-UPL-01: TEST-api-UPL for POST /v1/uploads (CTL-05), against the worker's media test bucket.
const PATH = '/v1/uploads';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHOTO_LIMIT = 8_388_608;
// uploads.create: 30 a minute per user.
const UPLOADS_LIMIT = 30;
const AVATAR_PER_DAY = 20;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

const AVATAR_JPEG = { kind: 'photo', purpose: 'avatar', contentType: 'image/jpeg', size: 500_000 };

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Five seconds into a minute, so no case crosses a minute window.
  const at = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function now(): Date {
  return testApp.deps.clock.now();
}

function ago(ms: number): Date {
  return new Date(now().getTime() - ms);
}

function createUpload(body: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(PATH, { body, ...options });
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<Envelope> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  return body;
}

async function expectTicket(response: TestResponse): Promise<UploadTicket> {
  expect(response.status).toBe(201);
  return UploadTicketSchema.parse(await response.json());
}

/** A user signed in by bearer (an `ios` client). */
async function member(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, overrides);
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function uploadsOf(userId: string) {
  return testApp.deps.db
    .select()
    .from(uploads)
    .where(eq(uploads.userId, userId))
    .orderBy(uploads.id);
}

function filledBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = index % 251;
  }
  return bytes;
}

// `count` avatar rows of the user, the oldest at `oldest` and the rest spread over the next hour.
async function avatarRows(userId: string, oldest: Date, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const createdAt = new Date(oldest.getTime() + index * MINUTE_MS);
    await insertUpload(testApp.deps.db, { userId, id: idAt(createdAt), createdAt });
  }
}

describe('POST /v1/uploads', () => {
  it('ok', async () => {
    const { user, auth } = await member();
    const response = await createUpload(AVATAR_JPEG, { auth });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const ticket = await expectTicket(response);
    expect(ticket.method).toBe('POST');
    expect(ticket.headers).toEqual({});
    expect(ticket.maxBytes).toBe(PHOTO_LIMIT);
    expect(ticket.expiresAt).toBe(new Date(now().getTime() + 300 * SECOND_MS).toISOString());
    expect(ticket.key).toBe(`incoming/${user.id}/${ticket.uploadId}.jpg`);

    const rows = await uploadsOf(user.id);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.id).toBe(ticket.uploadId);
    expect(row?.key).toBe(ticket.key);
    expect(row?.purpose).toBe('avatar');
    expect(row?.kind).toBe('photo');
    expect(row?.platform).toBe('ios');
    expect(row?.contentType).toBe('image/jpeg');
    expect(row?.maxBytes).toBe(PHOTO_LIMIT);
    expect(row?.declaredBytes).toBe(500_000);
    expect(row?.consumedAt).toBeNull();

    const bytes = filledBytes(500_000);
    const posted = await uploadWithPolicy(ticket, bytes, 'image/jpeg');
    expect(posted.status).toBeGreaterThanOrEqual(200);
    expect(posted.status).toBeLessThan(300);
    const stored = await getTestObject('media', ticket.key);
    expect(stored).not.toBeNull();
    expect(stored?.length).toBe(bytes.length);
    expect(Buffer.from(stored ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(true);
  });

  it('a web ticket records the web platform', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectTicket(await createUpload(AVATAR_JPEG, { auth: cookie }));
    const [row] = await uploadsOf(user.id);
    expect(row?.platform).toBe('web');
  });

  it('declared size over the limit is refused', async () => {
    const { user, auth } = await member();
    const body = await expectEnvelope(
      await createUpload({ ...AVATAR_JPEG, size: PHOTO_LIMIT + 1 }, { auth }),
      'upload_too_large',
    );
    expect(body.error.fields).toEqual({ size: 'out_of_range' });
    expect(await uploadsOf(user.id)).toEqual([]);
  });

  it('video for an avatar is refused', async () => {
    const { user, auth } = await member();
    const body = await expectEnvelope(
      await createUpload(
        { kind: 'video', purpose: 'avatar', contentType: 'video/mp4', size: 1000 },
        { auth },
      ),
      'invalid_request',
    );
    expect(body.error.fields).toEqual({ kind: 'not_allowed' });
    expect(await uploadsOf(user.id)).toEqual([]);
  });

  it('a disallowed type is refused', async () => {
    const { user, auth } = await member();
    const body = await expectEnvelope(
      await createUpload({ ...AVATAR_JPEG, contentType: 'image/heic' }, { auth }),
      'invalid_request',
    );
    expect(Object.keys(body.error.fields)).toEqual(['contentType']);
    expect(await uploadsOf(user.id)).toEqual([]);
  });

  it('image/png with kind video answers invalid_value on contentType', async () => {
    const { auth } = await member();
    const body = await expectEnvelope(
      await createUpload(
        { kind: 'video', purpose: 'avatar', contentType: 'image/png', size: 1000 },
        { auth },
      ),
      'invalid_request',
    );
    expect(body.error.fields['contentType']).toBe('invalid_value');
  });

  it('purpose post answers 400 on purpose', async () => {
    const { user, auth } = await member();
    const body = await expectEnvelope(
      await createUpload({ ...AVATAR_JPEG, purpose: 'post' }, { auth }),
      'invalid_request',
    );
    expect(Object.keys(body.error.fields)).toEqual(['purpose']);
    expect(await uploadsOf(user.id)).toEqual([]);
  });

  it('the twenty-first avatar ticket in 24 hours answers daily_limit_reached', async () => {
    const { user, auth } = await member();
    const oldest = ago(DAY_MS - 10 * SECOND_MS);
    await avatarRows(user.id, oldest, AVATAR_PER_DAY);
    const response = await createUpload(AVATAR_JPEG, { auth });
    await expectEnvelope(response, 'daily_limit_reached');
    expect(response.headers.get('retry-after')).toBe('10');
    expect(await uploadsOf(user.id)).toHaveLength(AVATAR_PER_DAY);
  });

  it('tickets asked for at once never pass the daily limit', async () => {
    const { user, auth } = await member();
    await avatarRows(user.id, ago(HOUR_MS), AVATAR_PER_DAY - 1);
    const answers = await withWritesHeld('uploads', 2, () => [
      createUpload(AVATAR_JPEG, { auth }),
      createUpload(AVATAR_JPEG, { auth }),
    ]);
    expect(answers.map((response) => response.status).sort()).toEqual([201, 429]);
    for (const response of answers.filter((answer) => answer.status === 429)) {
      await expectEnvelope(response, 'daily_limit_reached');
    }
    expect(await uploadsOf(user.id)).toHaveLength(AVATAR_PER_DAY);
  });

  it('the limit counts only avatar rows of the caller', async () => {
    const { user, auth } = await member();
    const other = await member();
    const oldest = ago(HOUR_MS);
    await avatarRows(other.user.id, oldest, AVATAR_PER_DAY);
    for (let index = 0; index < AVATAR_PER_DAY; index += 1) {
      const createdAt = new Date(oldest.getTime() + index * MINUTE_MS);
      await insertUpload(testApp.deps.db, {
        userId: user.id,
        id: idAt(createdAt),
        createdAt,
        purpose: 'post',
      });
    }
    await expectTicket(await createUpload(AVATAR_JPEG, { auth }));
  });

  it('a ticket 24 hours and 1 second after the oldest of twenty succeeds', async () => {
    const { user, auth } = await member();
    await avatarRows(user.id, ago(DAY_MS + SECOND_MS), 1);
    await avatarRows(user.id, ago(HOUR_MS), AVATAR_PER_DAY - 1);
    await expectTicket(await createUpload(AVATAR_JPEG, { auth }));
    expect(await uploadsOf(user.id)).toHaveLength(AVATAR_PER_DAY + 1);
  });

  it('logged out answers 401', async () => {
    await expectEnvelope(await createUpload(AVATAR_JPEG), 'unauthenticated');
  });

  it('a suspended user answers account_suspended', async () => {
    const { user, auth } = await member({
      status: 'suspended',
      suspendedAt: ago(DAY_MS),
      suspendedReason: 'spam',
    });
    await expectEnvelope(await createUpload(AVATAR_JPEG, { auth }), 'account_suspended');
    expect(await uploadsOf(user.id)).toEqual([]);
  });

  it('a web call without Origin answers origin_rejected', async () => {
    const user = await insertUser(testApp.deps.db);
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await createUpload(AVATAR_JPEG, { auth: cookie, origin: null }),
      'origin_rejected',
    );
    await expectEnvelope(
      await createUpload(AVATAR_JPEG, { auth: cookie, origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
    expect(await uploadsOf(user.id)).toEqual([]);
  });

  it('an avatar ticket works at every onboarding step', async () => {
    for (const onboardingStep of ['photo', 'handle', 'issues', 'location', 'done'] as const) {
      const { user, auth } = await member({ onboardingStep });
      await expectTicket(await createUpload(AVATAR_JPEG, { auth }));
      expect(await uploadsOf(user.id)).toHaveLength(1);
    }
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

    const cases: { body: unknown; field: string }[] = [
      { body: {}, field: 'kind' },
      { body: { ...AVATAR_JPEG, kind: 'audio' }, field: 'kind' },
      { body: { ...AVATAR_JPEG, size: 0 }, field: 'size' },
      { body: { ...AVATAR_JPEG, size: 1.5 }, field: 'size' },
      { body: { ...AVATAR_JPEG, size: '500000' }, field: 'size' },
      { body: { ...AVATAR_JPEG, size: Number.MAX_SAFE_INTEGER + 2 }, field: 'size' },
      { body: { ...AVATAR_JPEG, contentType: 'text/html' }, field: 'contentType' },
    ];
    for (const { body, field } of cases) {
      const envelope = await expectEnvelope(await createUpload(body, { auth }), 'invalid_request');
      expect(Object.keys(envelope.error.fields)).toContain(field);
    }
    expect(await uploadsOf(user.id)).toEqual([]);

    // An unknown key is dropped, never refused or stored.
    const ticket = await expectTicket(
      await createUpload(
        { ...AVATAR_JPEG, key: 'avatars/someone/else.jpg', userId: 'x' },
        { auth },
      ),
    );
    expect(ticket.key.startsWith(`incoming/${user.id}/`)).toBe(true);
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await createUpload(AVATAR_JPEG), 'unauthenticated');
    const { user, auth } = await member();
    await expectEnvelope(
      await createUpload({ ...AVATAR_JPEG, size: 0 }, { auth }),
      'invalid_request',
    );
    await expectEnvelope(
      await createUpload({ ...AVATAR_JPEG, size: PHOTO_LIMIT + 1 }, { auth }),
      'upload_too_large',
    );
    await expectEnvelope(
      await createUpload(AVATAR_JPEG, { auth, client: null }),
      'client_header_required',
    );
    await expectEnvelope(
      await createUpload(AVATAR_JPEG, { auth, client: 'ios/0.0.1' }),
      'upgrade_required',
    );
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await createUpload(AVATAR_JPEG, { auth: cookie, origin: null }),
      'origin_rejected',
    );
    await avatarRows(user.id, ago(HOUR_MS), AVATAR_PER_DAY);
    await expectEnvelope(await createUpload(AVATAR_JPEG, { auth }), 'daily_limit_reached');
    const suspended = await member({
      status: 'suspended',
      suspendedAt: ago(DAY_MS),
      suspendedReason: 'spam',
    });
    await expectEnvelope(
      await createUpload(AVATAR_JPEG, { auth: suspended.auth }),
      'account_suspended',
    );
  });

  it('rate-limited', async () => {
    const { user, auth } = await member();
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:uploads:1m`,
      windowStart,
      count: UPLOADS_LIMIT,
    });
    const response = await createUpload(AVATAR_JPEG, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect(await uploadsOf(user.id)).toEqual([]);
  });

  it('the url, fields and key appear in no log line', async () => {
    const { auth } = await member();
    const ticket = await expectTicket(await createUpload(AVATAR_JPEG, { auth }));
    const signature = ticket.fields['X-Amz-Signature'];
    const policy = ticket.fields['Policy'];
    if (signature === undefined || policy === undefined) {
      throw new Error('The ticket carries no signed policy.');
    }
    // The always-on scan looks for these too, and for X-Amz-Signature, after the test.
    registerScanValue(ticket.key);
    registerScanValue(signature);
    registerScanValue(policy);
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(ticket.key);
      expect(line.raw).not.toContain('incoming/');
      expect(line.raw).not.toContain('X-Amz-Signature');
      expect(line.raw).not.toContain(signature);
      expect(line.raw).not.toContain(policy);
      expect(line.raw).not.toContain(ticket.url);
    }
  });
});
