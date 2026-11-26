import { bookmarks } from '@citizenrun/db';
import {
  insertBookmark,
  insertDistrict,
  insertJurisdiction,
  insertOffice,
  insertRateCounter,
  insertUser,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-OFF-07: TEST-api-OFF for DELETE /v1/offices/:id/bookmark.
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';
const TOGGLES_PER_MINUTE = 120;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

async function office(overrides: Parameters<typeof insertOffice>[1] = {}) {
  const { db } = testApp.deps;
  const jurisdiction = await insertJurisdiction(db);
  const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id });
  return insertOffice(db, {
    jurisdictionId: jurisdiction.id,
    districtId: district.id,
    ...overrides,
  });
}

/** A user who saved `officeId`, signed in. */
async function saver(
  officeId: string,
  overrides: Parameters<typeof insertUser>[1] = {},
  kind: 'bearer' | 'cookie' = 'bearer',
) {
  const row = await insertUser(testApp.deps.db, overrides);
  await insertBookmark(testApp.deps.db, { userId: row.id, officeId });
  return { userId: row.id, auth: await signIn(testApp.deps.db, row, kind) };
}

function unbookmark(officeId: string, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.delete(`/v1/offices/${officeId}/bookmark`, options);
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body: unknown = await response.json();
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
}

async function rows(userId: string) {
  return testApp.deps.db.select().from(bookmarks).where(eq(bookmarks.userId, userId));
}

describe('DELETE /v1/offices/:id/bookmark', () => {
  it('ok', async () => {
    const target = await office();
    const { userId, auth } = await saver(target.id);
    const response = await unbookmark(target.id, { auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bookmarked: false });
    expect(await rows(userId)).toHaveLength(0);
  });

  it('rejects invalid input', async () => {
    const target = await office();
    const { auth } = await saver(target.id);
    await expectEnvelope(await unbookmark('not-a-uuid', { auth }), 'invalid_request');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await unbookmark(UNKNOWN_ID), 'unauthenticated');
    const target = await office();
    const { auth } = await saver(target.id);
    await expectEnvelope(await unbookmark('not-a-uuid', { auth }), 'invalid_request');
  });

  it('requires a session', async () => {
    const target = await office();
    const { userId } = await saver(target.id);
    await expectEnvelope(await unbookmark(target.id), 'unauthenticated');
    const row = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, row, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * DAY_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(await unbookmark(target.id, { auth: expired }), 'unauthenticated');
    expect(await rows(userId)).toHaveLength(1);
  });

  it('checks origin on cookie writes', async () => {
    const target = await office();
    const { userId, auth } = await saver(target.id, {}, 'cookie');
    await expectEnvelope(await unbookmark(target.id, { auth, origin: null }), 'origin_rejected');
    expect(await rows(userId)).toHaveLength(1);
    expect((await unbookmark(target.id, { auth })).status).toBe(200);
    expect(await rows(userId)).toHaveLength(0);
  });

  it('suspended accounts cannot write', async () => {
    const target = await office();
    const { userId, auth } = await saver(target.id, {
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await unbookmark(target.id, { auth }), 'account_suspended');
    expect(await rows(userId)).toHaveLength(1);
  });

  it('rate-limited', async () => {
    const target = await office();
    const { userId, auth } = await saver(target.id);
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:toggle:1m`,
      windowStart,
      count: TOGGLES_PER_MINUTE,
    });
    const response = await unbookmark(target.id, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect(await rows(userId)).toHaveLength(1);
  });

  it('repeat is safe', async () => {
    const target = await office();
    const { userId, auth } = await saver(target.id);
    for (let call = 0; call < 3; call += 1) {
      expect(await (await unbookmark(target.id, { auth })).json()).toEqual({ bookmarked: false });
    }
    expect(await rows(userId)).toHaveLength(0);
  });

  it('deleting twice answers 200', async () => {
    const target = await office();
    const { auth } = await saver(target.id);
    expect((await unbookmark(target.id, { auth })).status).toBe(200);
    expect((await unbookmark(target.id, { auth })).status).toBe(200);
  });

  it('a retired office can be removed', async () => {
    const target = await office({ retiredAt: new Date('2026-01-01T00:00:00.000Z') });
    const { userId, auth } = await saver(target.id);
    expect((await unbookmark(target.id, { auth })).status).toBe(200);
    expect(await rows(userId)).toHaveLength(0);
  });
});
