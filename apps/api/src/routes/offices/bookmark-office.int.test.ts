import { bookmarks, offices } from '@citizenrun/db';
import {
  insertDistrict,
  insertJurisdiction,
  insertOffice,
  insertRateCounter,
  insertUser,
  makeOffice,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, OfficeDetailSchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-OFF-06: TEST-api-OFF and INV-06 for POST /v1/offices/:id/bookmark.
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';
const TOGGLES_PER_MINUTE = 120;
// One more than the follow limit of a new account: no daily limit applies to bookmarks.
const MANY_BOOKMARKS = 101;

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

async function user(
  overrides: Parameters<typeof insertUser>[1] = {},
  kind: 'bearer' | 'cookie' = 'bearer',
): Promise<{ userId: string; auth: TestAuth }> {
  const row = await insertUser(testApp.deps.db, overrides);
  return { userId: row.id, auth: await signIn(testApp.deps.db, row, kind) };
}

function bookmark(officeId: string, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(`/v1/offices/${officeId}/bookmark`, options);
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

describe('POST /v1/offices/:id/bookmark', () => {
  it('ok', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const response = await bookmark(target.id, { auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bookmarked: true });
    const stored = await rows(userId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.createdAt.toISOString()).toBe(testApp.deps.clock.now().toISOString());
  });

  it('rejects invalid input', async () => {
    const { auth } = await user();
    await expectEnvelope(await bookmark('not-a-uuid', { auth }), 'invalid_request');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await bookmark(UNKNOWN_ID), 'unauthenticated');
    const { auth } = await user();
    await expectEnvelope(await bookmark('not-a-uuid', { auth }), 'invalid_request');
    await expectEnvelope(await bookmark(UNKNOWN_ID, { auth }), 'not_found');
  });

  it('requires a session', async () => {
    const target = await office();
    await expectEnvelope(await bookmark(target.id), 'unauthenticated');
    const row = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, row, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * DAY_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(await bookmark(target.id, { auth: expired }), 'unauthenticated');
    expect(await rows(row.id)).toHaveLength(0);
  });

  it('needs finished onboarding', async () => {
    const target = await office();
    const { userId, auth } = await user({ onboardingStep: 'location', onboardedAt: null });
    await expectEnvelope(await bookmark(target.id, { auth }), 'onboarding_incomplete');
    expect(await rows(userId)).toHaveLength(0);
  });

  it('checks origin on cookie writes', async () => {
    const target = await office();
    const { userId, auth } = await user({}, 'cookie');
    await expectEnvelope(await bookmark(target.id, { auth, origin: null }), 'origin_rejected');
    expect(await rows(userId)).toHaveLength(0);
    expect((await bookmark(target.id, { auth })).status).toBe(200);
  });

  it('suspended accounts cannot write', async () => {
    const target = await office();
    const { userId, auth } = await user({
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await bookmark(target.id, { auth }), 'account_suspended');
    expect(await rows(userId)).toHaveLength(0);
  });

  it('rate-limited', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:toggle:1m`,
      windowStart,
      count: TOGGLES_PER_MINUTE,
    });
    const response = await bookmark(target.id, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });

  it('repeat is safe', async () => {
    const target = await office();
    const { userId, auth } = await user();
    for (let call = 0; call < 3; call += 1) {
      const response = await bookmark(target.id, { auth });
      expect(await response.json()).toEqual({ bookmarked: true });
    }
    expect(await rows(userId)).toHaveLength(1);
  });

  it('bookmarking twice keeps one row', async () => {
    const target = await office();
    const { userId, auth } = await user();
    expect((await bookmark(target.id, { auth })).status).toBe(200);
    expect((await bookmark(target.id, { auth })).status).toBe(200);
    expect(await rows(userId)).toHaveLength(1);
  });

  it('a retired office answers 422', async () => {
    const target = await office({ retiredAt: new Date('2026-01-01T00:00:00.000Z') });
    const { userId, auth } = await user();
    await expectEnvelope(await bookmark(target.id, { auth }), 'office_retired');
    expect(await rows(userId)).toHaveLength(0);
  });

  it("another user's office page shows bookmarked false for them", async () => {
    const target = await office();
    const a = await user();
    const b = await user();
    expect((await bookmark(target.id, { auth: a.auth })).status).toBe(200);
    const read = async (auth: TestAuth | null) => {
      const response = await testApp.request.get(`/v1/offices/${target.slug}`, { auth });
      expect(response.status).toBe(200);
      return OfficeDetailSchema.parse(await response.json()).viewer.bookmarked;
    };
    expect(await read(b.auth)).toBe(false);
    expect(await read(null)).toBe(false);
    expect(await read(a.auth)).toBe(true);
  });

  it('no daily limit applies', async () => {
    const { db } = testApp.deps;
    const first = await office();
    // The other offices share the first one's jurisdiction and district.
    const values = Array.from({ length: MANY_BOOKMARKS - 1 }, () =>
      makeOffice({
        jurisdictionId: first.jurisdictionId,
        districtId: first.districtId,
        officeTypeId: first.officeTypeId,
        state: first.state,
      }),
    );
    const ids = [first.id, ...values.map((value) => value.id)];
    await db.insert(offices).values(values);
    const { userId, auth } = await user();
    for (const id of ids) {
      const response = await bookmark(id, { auth });
      expect(response.status, id).toBe(200);
    }
    expect(await rows(userId)).toHaveLength(MANY_BOOKMARKS);
  });
});
