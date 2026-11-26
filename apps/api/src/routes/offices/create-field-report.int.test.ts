import { elections, fieldReports, filingTracks, offices } from '@citizenrun/db';
import {
  idAt,
  insertDistrict,
  insertElection,
  insertFieldReport,
  insertFilingTrack,
  insertJurisdiction,
  insertOffice,
  insertRateCounter,
  insertUser,
} from '@citizenrun/db/testing';
import {
  ERROR_CODES,
  ErrorEnvelopeSchema,
  FieldReportCreatedSchema,
  LIMITS,
} from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-OFF-09: TEST-field-reports, INV-29 and INV-39 for POST /v1/offices/:id/field-reports.
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';
// field_report: 5 a minute per user.
const REPORTS_PER_MINUTE = 5;
const NOTE = { field: 'pay_annual_cents', message: 'The pay went up this year.' } as const;

let testApp: TestApp;

// The clock stays at the real time: a stored report's id is a version 7 uuid of the real clock.
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

/** A finished user `ageMs` old at the clock's time, signed in by bearer unless told otherwise. */
async function user(
  ageMs: number = 30 * DAY_MS,
  overrides: Parameters<typeof insertUser>[1] = {},
  kind: 'bearer' | 'cookie' = 'bearer',
): Promise<{ userId: string; auth: TestAuth }> {
  const createdAt = new Date(testApp.deps.clock.now().getTime() - ageMs);
  const row = await insertUser(testApp.deps.db, {
    createdAt,
    onboardedAt: createdAt,
    ...overrides,
  });
  return { userId: row.id, auth: await signIn(testApp.deps.db, row, kind) };
}

function report(officeId: string, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(`/v1/offices/${officeId}/field-reports`, options);
}

async function expectEnvelope(
  response: TestResponse,
  code: ErrorCode,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body = await response.json<{ error: Record<string, unknown> }>(); // checked below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
  return body.error;
}

async function reportsOf(userId: string) {
  return testApp.deps.db.select().from(fieldReports).where(eq(fieldReports.userId, userId));
}

describe('POST /v1/offices/:id/field-reports', () => {
  it('ok', async () => {
    const target = await office();
    const { auth } = await user();
    const response = await report(target.id, { auth, body: NOTE });
    expect(response.status).toBe(201);
    expect(FieldReportCreatedSchema.parse(await response.json()).id).toMatch(UUID_PATTERN);
  });

  it('rejects invalid input', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const cases: Array<[unknown, string, string]> = [
      [{ ...NOTE, field: 'not_a_field' }, 'field', 'invalid_value'],
      [{ field: null, message: 'x'.repeat(LIMITS.reportNoteChars + 1) }, 'message', 'too_long'],
      [{ field: null, message: 42 }, 'message', 'invalid_type'],
      [{ field: null, sourceUrl: 'x'.repeat(2049) }, 'sourceUrl', 'too_long'],
      [{ field: null, message: '   ' }, 'message', 'too_short'],
    ];
    for (const [body, path, code] of cases) {
      const error = await expectEnvelope(
        await report(target.id, { auth, body }),
        'invalid_request',
      );
      expect(error['fields'], path).toMatchObject({ [path]: code });
    }
    // A second user, since every request counts toward the per-minute policy.
    const other = await user();
    await expectEnvelope(
      await report('not-a-uuid', { auth: other.auth, body: NOTE }),
      'invalid_request',
    );
    // An unknown key is dropped, never stored.
    const extra = await report(target.id, {
      auth: other.auth,
      body: { ...NOTE, extra: 'fixture' },
    });
    expect(extra.status).toBe(201);
    expect(await reportsOf(userId)).toEqual([]);
    expect(await reportsOf(other.userId)).toHaveLength(1);
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await report(UNKNOWN_ID, { body: NOTE }), 'unauthenticated');
    const { auth } = await user();
    await expectEnvelope(await report(UNKNOWN_ID, { auth, body: {} }), 'invalid_request');
    await expectEnvelope(await report(UNKNOWN_ID, { auth, body: NOTE }), 'not_found');
    const target = await office();
    const error = await expectEnvelope(
      await report(target.id, { auth, body: { field: null, sourceUrl: 'http://example.org' } }),
      'link_invalid',
    );
    expect(JSON.stringify(error)).not.toContain('example.org');
  });

  it('requires a session', async () => {
    const target = await office();
    await expectEnvelope(await report(target.id, { body: NOTE }), 'unauthenticated');
    const row = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, row, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * DAY_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(await report(target.id, { auth: expired, body: NOTE }), 'unauthenticated');
    expect(await reportsOf(row.id)).toHaveLength(0);
  });

  it('needs finished onboarding', async () => {
    const target = await office();
    const { userId, auth } = await user(30 * DAY_MS, {
      onboardingStep: 'issues',
      onboardedAt: null,
    });
    await expectEnvelope(await report(target.id, { auth, body: NOTE }), 'onboarding_incomplete');
    expect(await reportsOf(userId)).toHaveLength(0);
  });

  it('checks origin on cookie writes', async () => {
    const target = await office();
    const { userId, auth } = await user(30 * DAY_MS, {}, 'cookie');
    await expectEnvelope(
      await report(target.id, { auth, origin: null, body: NOTE }),
      'origin_rejected',
    );
    expect(await reportsOf(userId)).toHaveLength(0);
    expect((await report(target.id, { auth, body: NOTE })).status).toBe(201);
  });

  it('suspended accounts cannot write', async () => {
    const target = await office();
    const { userId, auth } = await user(30 * DAY_MS, {
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await report(target.id, { auth, body: NOTE }), 'account_suspended');
    expect(await reportsOf(userId)).toHaveLength(0);
  });

  it('rate-limited', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:freport:1m`,
      windowStart,
      count: REPORTS_PER_MINUTE,
    });
    const response = await report(target.id, { auth, body: NOTE });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect(await reportsOf(userId)).toHaveLength(0);
  });

  it('a report is stored with its field and the user', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const response = await report(target.id, { auth, body: NOTE });
    expect(response.status).toBe(201);
    const { id } = FieldReportCreatedSchema.parse(await response.json());
    const [row] = await reportsOf(userId);
    expect(row).toMatchObject({
      id,
      userId,
      officeId: target.id,
      field: 'pay_annual_cents',
      message: NOTE.message,
      sourceUrl: null,
      status: 'open',
      exportedAt: null,
    });
    expect(row?.createdAt.toISOString()).toBe(testApp.deps.clock.now().toISOString());
  });

  it('the whole office is a null field', async () => {
    const target = await office();
    const { userId, auth } = await user();
    expect(
      (await report(target.id, { auth, body: { message: 'Fixture whole office.' } })).status,
    ).toBe(201);
    expect((await reportsOf(userId))[0]?.field).toBeNull();
  });

  it('the stored link is the parsed one', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const body = { field: null, sourceUrl: 'https://Example.org/page?x=1' };
    expect((await report(target.id, { auth, body })).status).toBe(201);
    expect((await reportsOf(userId))[0]?.sourceUrl).toBe('https://example.org/page?x=1');
  });

  it('an unsafe link answers 422 link_invalid', async () => {
    const target = await office();
    const { userId, auth } = await user();
    for (const sourceUrl of [
      'http://example.org',
      'https://user:pw@example.org',
      'https://192.168.0.1/',
      `https://example.org/${'a'.repeat(201 - 'https://example.org/'.length)}`,
    ]) {
      await expectEnvelope(
        await report(target.id, { auth, body: { ...NOTE, sourceUrl } }),
        'link_invalid',
      );
    }
    expect(await reportsOf(userId)).toHaveLength(0);
  });

  it('neither a note nor a link answers 400', async () => {
    const target = await office();
    const { auth } = await user();
    for (const body of [{ field: 'seats' }, { field: null, message: null, sourceUrl: null }]) {
      const error = await expectEnvelope(
        await report(target.id, { auth, body }),
        'invalid_request',
      );
      expect(error['fields']).toEqual({ message: 'required' });
    }
  });

  it('an unknown field answers 400', async () => {
    const target = await office();
    const { auth } = await user();
    const error = await expectEnvelope(
      await report(target.id, { auth, body: { ...NOTE, field: 'pay' } }),
      'invalid_request',
    );
    expect(error['fields']).toMatchObject({ field: 'invalid_value' });
  });

  it('a two-hour-old account answers 422 account_too_new', async () => {
    const target = await office();
    const { userId, auth } = await user(2 * HOUR_MS);
    await expectEnvelope(await report(target.id, { auth, body: NOTE }), 'account_too_new');
    expect(await reportsOf(userId)).toHaveLength(0);
  });

  it('an account exactly 24 hours old may report', async () => {
    const target = await office();
    const { auth } = await user(DAY_MS);
    expect((await report(target.id, { auth, body: NOTE })).status).toBe(201);
  });

  it('the eleventh report in 24 hours answers 429 with Retry-After', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const now = testApp.deps.clock.now();
    const oldest = new Date(now.getTime() - 20 * HOUR_MS);
    for (let index = 0; index < LIMITS.fieldReportsPerDay; index += 1) {
      const createdAt = new Date(oldest.getTime() + index * MINUTE_MS);
      await insertFieldReport(testApp.deps.db, {
        userId,
        officeId: target.id,
        id: idAt(createdAt),
        createdAt,
      });
    }
    const response = await report(target.id, { auth, body: NOTE });
    await expectEnvelope(response, 'daily_limit_reached');
    const wait = Math.ceil((oldest.getTime() + DAY_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(wait));
    expect(await reportsOf(userId)).toHaveLength(LIMITS.fieldReportsPerDay);
  });

  it('the source link is never requested', async () => {
    const target = await office();
    const { auth } = await user();
    const body = { ...NOTE, sourceUrl: 'https://example.org/fixture-source' };
    expect((await report(target.id, { auth, body })).status).toBe(201);
    expect(testApp.fakes.outbound.calls).toEqual([]);
  });

  it('a report changes no office column', async () => {
    const { db } = testApp.deps;
    const target = await office({ payAnnualCents: 1_000_000, fieldMeta: {} });
    const election = await insertElection(db, { officeId: target.id });
    await insertFilingTrack(db, { electionId: election.id });
    const snapshot = async () => ({
      office: await db.select().from(offices).where(eq(offices.id, target.id)),
      elections: await db.select().from(elections).where(eq(elections.officeId, target.id)),
      tracks: await db.select().from(filingTracks).where(eq(filingTracks.electionId, election.id)),
    });
    const before = await snapshot();
    const { auth } = await user();
    const body = {
      field: 'pay_annual_cents',
      message: 'Fixture pay is wrong.',
      sourceUrl: 'https://example.org/pay',
    };
    expect((await report(target.id, { auth, body })).status).toBe(201);
    expect(await snapshot()).toEqual(before);
  });

  it('a retired office answers 422', async () => {
    const target = await office({ retiredAt: new Date('2026-01-01T00:00:00.000Z') });
    const { userId, auth } = await user();
    await expectEnvelope(await report(target.id, { auth, body: NOTE }), 'office_retired');
    expect(await reportsOf(userId)).toHaveLength(0);
  });

  it('an unknown office answers 404', async () => {
    const { auth } = await user();
    await expectEnvelope(await report(UNKNOWN_ID, { auth, body: NOTE }), 'not_found');
  });

  it('enqueues nothing', async () => {
    const target = await office();
    const { auth } = await user();
    const count = async () =>
      (
        await testApp.deps.db.execute<{ n: number }>(
          sql`select count(*)::int as n from pgboss.job`,
          'objects',
        )
      )[0]?.n ?? 0;
    const before = await count();
    expect((await report(target.id, { auth, body: NOTE })).status).toBe(201);
    expect(await count()).toBe(before);
  });
});
