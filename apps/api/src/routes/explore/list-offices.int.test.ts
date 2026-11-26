import { offices, refreshOfficeSearch } from '@citizenrun/db';
import type { OfficeRow } from '@citizenrun/db';
import {
  insertBookmark,
  insertDistrict,
  insertDistrictFallback,
  insertFollow,
  insertJurisdiction,
  insertOffice,
  insertRateCounter,
  insertUser,
  makeOffice,
  setOfficeIssues,
  setUserDistricts,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, OfficeListPageSchema } from '@citizenrun/shared';
import type { ErrorCode, OfficeListPage, OfficeSort } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-EXP-01: TEST-api-EXP's cases for GET /v1/offices, on factory rows of the fixture
// states ZX, ZY and ZZ.
const NOW = new Date('2027-03-05T12:00:00.000Z');
// Pago Pago's date at NOW.
const TODAY = '2027-03-05';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXPLORE_PER_MINUTE = 120;
const MINUTE_MS = 60_000;
const SORTS: readonly OfficeSort[] = ['opportunity', 'impact', 'ease', 'pay', 'deadline'];
const BATCH = 1_000;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  testApp.deps.clock.set(NOW);
  // The fixture states besides ZZ, before the first request reads state_rules.
  await testApp.deps.db.execute(
    sql`insert into state_rules (state) values ('ZX'), ('ZY') on conflict do nothing`,
  );
});

function plus(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  return new Date(at.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

async function viewer(
  districtIds?: readonly string[],
): Promise<{ userId: string; auth: TestAuth }> {
  const user = await insertUser(testApp.deps.db);
  if (districtIds !== undefined) {
    await setUserDistricts(testApp.deps.db, user.id, districtIds);
  }
  // The session outlives the fixed clock.
  const expiresAt = new Date(NOW.getTime() + 90 * 86_400_000);
  return { userId: user.id, auth: await signIn(testApp.deps.db, user, 'bearer', { expiresAt }) };
}

function list(auth: TestAuth | null, query: Record<string, string> = {}): Promise<TestResponse> {
  const options: TestRequestOptions = { auth, query };
  return testApp.request.get('/v1/offices', options);
}

async function pageOf(auth: TestAuth, query: Record<string, string> = {}): Promise<OfficeListPage> {
  const response = await list(auth, query);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return OfficeListPageSchema.parse(JSON.parse(text));
}

function idsOf(page: OfficeListPage): string[] {
  return page.items.map((item) => item.id);
}

/** Every page of a query, following nextCursor. */
async function allPages(auth: TestAuth, query: Record<string, string>): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor: string | null = null;
  do {
    const page: OfficeListPage = await pageOf(auth, {
      ...query,
      ...(cursor === null ? {} : { cursor }),
    });
    pages.push(idsOf(page));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

async function expectEnvelope(
  response: TestResponse,
  code: ErrorCode,
  fields?: Record<string, string>,
): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body: unknown = await response.json();
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
  if (fields !== undefined) {
    expect(body).toMatchObject({ error: { fields } });
  }
}

type Fixture = { id: string; ease: number | null; pay: number | null; deadline: string | null };

function fixtureOf(row: OfficeRow): Fixture {
  return {
    id: row.id,
    ease: row.ease === null ? null : Number(row.ease),
    pay: row.payAnnualCents,
    deadline: row.nextFilingDeadline,
  };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullsLast<T extends number | string>(
  a: T | null,
  b: T | null,
  direction: 'asc' | 'desc',
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order = a < b ? -1 : 1;
  return direction === 'asc' ? order : -order;
}

/** The brute-force order of L-office-list step 5 while no office is scored. */
function expectedOrder(
  rows: readonly Fixture[],
  sort: OfficeSort,
  path: 'set' | 'ranked',
): string[] {
  const keyed = rows
    .filter((row) => !(sort === 'deadline' && path === 'ranked' && (row.deadline ?? '') < TODAY))
    .map((row) => {
      switch (sort) {
        case 'opportunity':
        case 'impact':
          return { id: row.id, key: null };
        case 'ease':
          return { id: row.id, key: row.ease };
        case 'pay':
          return { id: row.id, key: row.pay };
        case 'deadline':
          return {
            id: row.id,
            key: row.deadline !== null && row.deadline >= TODAY ? row.deadline : null,
          };
      }
    });
  const direction = sort === 'deadline' ? 'asc' : 'desc';
  return keyed
    .sort((a, b) => compareNullsLast(a.key, b.key, direction) || compareIds(a.id, b.id))
    .map((row) => row.id);
}

/** Offices with mixed ease, pay and deadline values, ties included, in a new jurisdiction of `state`. */
async function sortFixture(state: string, count: number, seed: number): Promise<OfficeRow[]> {
  const jurisdiction = await insertJurisdiction(testApp.deps.db, { state });
  const eases = ['50', null, '50', '70', '12'];
  const pays = [500_000, 500_000, null, 300_000, 900_000, null];
  const deadlines = [
    plus(TODAY, 10),
    null,
    plus(TODAY, -2),
    plus(TODAY, 10),
    plus(TODAY, 40),
    TODAY,
  ];
  const rows: OfficeRow[] = [];
  for (let n = 0; n < count; n += 1) {
    const i = n + seed;
    rows.push(
      await insertOffice(testApp.deps.db, {
        jurisdictionId: jurisdiction.id,
        ease: eases[i % eases.length] ?? null,
        payAnnualCents: pays[i % pays.length] ?? null,
        nextFilingDeadline: deadlines[i % deadlines.length] ?? null,
      }),
    );
  }
  return rows;
}

describe('GET /v1/offices', () => {
  it('ok', async () => {
    const office = await insertOffice(testApp.deps.db);
    const { auth } = await viewer([office.districtId]);
    const page = await pageOf(auth);
    expect(idsOf(page)).toEqual([office.id]);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: office.id,
      slug: office.slug,
      viewer: { bookmarked: false },
    });
  });

  it('rejects invalid input', async () => {
    const { auth } = await viewer();
    const invalid: Record<string, string>[] = [
      { limit: '0' },
      { limit: '51' },
      { scope: 'county' },
      { state: 'zz' },
      { district: 'not-a-uuid' },
      { jurisdiction: 'not-a-uuid' },
      { includeContained: 'yes' },
      { issue: 'not-an-issue' },
      { level: 'galactic' },
      { jurisdictionKind: 'empire' },
      { minPay: '-1' },
      { maxHours: '81' },
      { deadlineWithin: '0' },
      { deadlineWithin: '366' },
      { q: '   ' },
      { q: 'x'.repeat(101) },
      { sort: 'name' },
      { fitsDayJob: 'maybe' },
      { cursor: 'x'.repeat(513) },
    ];
    for (const query of invalid) {
      await expectEnvelope(await list(auth, query), 'invalid_request');
    }
  });

  it('envelope on every error', async () => {
    const { auth } = await viewer();
    await expectEnvelope(await list(auth, { limit: '0' }), 'invalid_request');
    await expectEnvelope(await list(auth, { cursor: 'x' }), 'invalid_cursor');
    await expectEnvelope(await list(null), 'unauthenticated');
    await expectEnvelope(await list(auth, { state: 'QQ' }), 'invalid_request', {
      state: 'invalid_value',
    });
  });

  it('requires a session', async () => {
    await expectEnvelope(await list(null), 'unauthenticated');
    await expectEnvelope(await list({ kind: 'bearer', token: 'A'.repeat(43) }), 'unauthenticated');
  });

  it('logged out answers 401', async () => {
    await insertOffice(testApp.deps.db);
    const response = await list(null, { scope: 'nation' });
    await expectEnvelope(response, 'unauthenticated');
  });

  it('rate-limited', async () => {
    const { userId, auth } = await viewer();
    const windowStart = new Date(Math.floor(NOW.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:explore:1m`,
      windowStart,
      count: EXPLORE_PER_MINUTE,
    });
    const response = await list(auth);
    await expectEnvelope(response, 'rate_limited');
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('pages with cursors', async () => {
    const district = await insertDistrict(testApp.deps.db);
    const ids: string[] = [];
    for (let n = 0; n < 25; n += 1) {
      ids.push((await insertOffice(testApp.deps.db, { districtId: district.id })).id);
    }
    const { auth } = await viewer([district.id]);
    const pages = await allPages(auth, { limit: '10' });
    expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual([...ids].sort(compareIds));
  });

  it('the default scope is mine for a viewer with districts', async () => {
    const county = await insertDistrict(testApp.deps.db);
    const fallback = await insertDistrictFallback(testApp.deps.db, { viaDistrictId: county.id });
    const countyOffice = await insertOffice(testApp.deps.db, { districtId: county.id });
    const special = await insertOffice(testApp.deps.db, { districtId: fallback.districtId });
    await insertOffice(testApp.deps.db);
    const { auth } = await viewer([county.id, fallback.districtId]);
    const page = await pageOf(auth);
    expect(idsOf(page).sort()).toEqual([countyOffice.id, special.id].sort());
    expect(page.total).toBe(2);
    const approximate = page.items.find((item) => item.id === special.id);
    expect(approximate?.district.geometryQuality).toBe('county_approx');
  });

  it('the default scope is nation for a viewer without districts', async () => {
    const zx = await sortFixture('ZX', 2, 0);
    const zz = await sortFixture('ZZ', 2, 1);
    const expected = [...zx, ...zz].map((row) => row.id).sort(compareIds);
    const { auth } = await viewer();
    const page = await pageOf(auth);
    expect(idsOf(page)).toEqual(expected);
    expect(page.total).toBeNull();
    // A user whose location was not covered yet holds no districts either.
    const { auth: notCovered } = await viewer([]);
    expect(idsOf(await pageOf(notCovered))).toEqual(expected);
  });

  it('each filter', async () => {
    const { db } = testApp.deps;
    const types = await db.execute<{ id: string; level: string }>(
      sql`select id, level from office_types order by id`,
      'objects',
    );
    const typeA = types[0];
    const typeB = types.find((row) => row.level !== typeA?.level);
    if (typeA === undefined || typeB === undefined) {
      throw new Error('The reference office types have one level only.');
    }
    const [issue] = await db.execute<{ id: string }>(
      sql`select id from issues order by sort limit 1`,
      'objects',
    );
    if (issue === undefined) {
      throw new Error('No issue.');
    }
    const city = await insertJurisdiction(db, { kind: 'city' });

    type Case = {
      query: Record<string, string>;
      match: Parameters<typeof insertOffice>[1];
      other: Parameters<typeof insertOffice>[1];
      after?: (match: OfficeRow, other: OfficeRow) => Promise<void>;
    };
    const cases: Case[] = [
      {
        query: { issue: issue.id },
        match: {},
        other: {},
        after: async (match) => {
          await setOfficeIssues(db, match.id, [{ issueId: issue.id, relevance: 2 }]);
        },
      },
      {
        query: { level: typeA.level },
        match: { officeTypeId: typeA.id },
        other: { officeTypeId: typeB.id },
      },
      {
        query: { officeType: typeB.id },
        match: { officeTypeId: typeB.id },
        other: { officeTypeId: typeA.id },
      },
      { query: { jurisdictionKind: 'city' }, match: { jurisdictionId: city.id }, other: {} },
      {
        query: { minPay: '500000' },
        match: { payAnnualCents: 500_000 },
        other: { payAnnualCents: null },
      },
      {
        query: { minPay: '500000' },
        match: { payAnnualCents: 600_000 },
        other: { payAnnualCents: 499_999 },
      },
      { query: { fitsDayJob: 'true' }, match: { fitsDayJob: 'yes' }, other: { fitsDayJob: 'no' } },
      {
        query: { fitsDayJob: 'true' },
        match: { fitsDayJob: 'likely' },
        other: { fitsDayJob: null },
      },
      { query: { maxHours: '10' }, match: { hoursPerWeek: '10' }, other: { hoursPerWeek: null } },
      { query: { maxHours: '10' }, match: { hoursPerWeek: '4.5' }, other: { hoursPerWeek: '11' } },
      {
        query: { q: 'treasurer' },
        match: { title: 'Fixture County Treasurer' },
        other: { title: 'Fixture Coroner' },
        after: async (match, other) => {
          await refreshOfficeSearch(db, [match.id, other.id]);
        },
      },
    ];
    for (const entry of cases) {
      const match = await insertOffice(db, entry.match);
      const other = await insertOffice(db, entry.other);
      await entry.after?.(match, other);
      const { auth } = await viewer([match.districtId, other.districtId]);
      expect((await pageOf(auth)).total, JSON.stringify(entry.query)).toBe(2);
      const page = await pageOf(auth, entry.query);
      expect(idsOf(page), JSON.stringify(entry.query)).toEqual([match.id]);
      expect(page.total).toBe(1);
    }
    // fitsDayJob=false is no filter.
    const yes = await insertOffice(db, { fitsDayJob: 'yes' });
    const no = await insertOffice(db, { fitsDayJob: 'no' });
    const { auth } = await viewer([yes.districtId, no.districtId]);
    expect((await pageOf(auth, { fitsDayJob: 'false' })).total).toBe(2);
  });

  it('deadlineWithin=14 keeps an office 14 days away and drops one 15 days away', async () => {
    const { db } = testApp.deps;
    const losAngeles = await insertJurisdiction(db, { timezone: 'America/Los_Angeles' });
    const newYork = await insertJurisdiction(db, { timezone: 'America/New_York' });
    // 23:30 on 2027-03-05 in Los Angeles; Pago Pago's date is 2027-03-05 too.
    const laNow = new Date('2027-03-06T07:30:00.000Z');
    const fourteen = await insertOffice(db, {
      jurisdictionId: losAngeles.id,
      nextFilingDeadline: '2027-03-19',
    });
    const fifteen = await insertOffice(db, {
      jurisdictionId: losAngeles.id,
      nextFilingDeadline: '2027-03-20',
    });
    const stale = await insertOffice(db, {
      jurisdictionId: losAngeles.id,
      nextFilingDeadline: '2027-03-04',
    });
    // 14 days after New York's date at 02:00 New York time (2027-03-06), one day after Pago Pago's bound.
    const nyNow = new Date('2027-03-06T07:00:00.000Z');
    const newYorkOffice = await insertOffice(db, {
      jurisdictionId: newYork.id,
      nextFilingDeadline: '2027-03-20',
    });
    const { auth } = await viewer([
      fourteen.districtId,
      fifteen.districtId,
      stale.districtId,
      newYorkOffice.districtId,
    ]);

    testApp.deps.clock.set(laNow);
    const la = await pageOf(auth, { deadlineWithin: '14', sort: 'deadline' });
    expect(idsOf(la)).toContain(fourteen.id);
    expect(idsOf(la)).not.toContain(fifteen.id);
    expect(idsOf(la)).not.toContain(stale.id);
    expect(la.total).toBeNull();
    // A page of one refills past the dropped rows and reads each kept row once.
    const pages = await allPages(auth, { deadlineWithin: '14', limit: '1' });
    expect(pages.flat().sort()).toEqual([...idsOf(la)].sort());
    expect(pages.flat()).toHaveLength(new Set(pages.flat()).size);

    testApp.deps.clock.set(nyNow);
    const ny = await pageOf(auth, { deadlineWithin: '14' });
    expect(idsOf(ny)).toContain(newYorkOffice.id);
    expect(idsOf(ny)).not.toContain(fifteen.id);
    expect(ny.total).toBeNull();
  });

  it('each sort orders nulls last and breaks ties by id', async () => {
    const rows = await sortFixture('ZZ', 10, 0);
    const { auth } = await viewer([...new Set(rows.map((row) => row.districtId))]);
    for (const sort of SORTS) {
      const page = await pageOf(auth, { sort });
      expect(idsOf(page), sort).toEqual(expectedOrder(rows.map(fixtureOf), sort, 'set'));
    }
  });

  it('paging through a three-state fixture returns each office once and in order', async () => {
    const zx = await sortFixture('ZX', 4, 0);
    const zy = await sortFixture('ZY', 5, 2);
    const zz = await sortFixture('ZZ', 4, 3);
    // Neither a placeholder nor a retired office is read on the ranked path.
    const zyJurisdiction = zy[0]?.jurisdictionId ?? '';
    await insertOffice(testApp.deps.db, { jurisdictionId: zyJurisdiction, placeholder: true });
    await insertOffice(testApp.deps.db, {
      jurisdictionId: zyJurisdiction,
      retiredAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    const { auth } = await viewer();
    for (const sort of SORTS) {
      const state = await allPages(auth, { sort, scope: 'state', state: 'ZY', limit: '3' });
      expect(state.flat(), `${sort} state`).toEqual(
        expectedOrder(zy.map(fixtureOf), sort, 'ranked'),
      );
      expect(state.slice(0, -1).every((page) => page.length === 3)).toBe(true);
      const nation = await allPages(auth, { sort, scope: 'nation', limit: '3' });
      expect(nation.flat(), `${sort} nation`).toEqual(
        expectedOrder([...zx, ...zy, ...zz].map(fixtureOf), sort, 'ranked'),
      );
    }
  });

  it('placeholders and retired offices never appear without a district or jurisdiction', async () => {
    const district = await insertDistrict(testApp.deps.db);
    const seat = await insertOffice(testApp.deps.db, { districtId: district.id });
    await insertOffice(testApp.deps.db, { districtId: district.id, placeholder: true });
    await insertOffice(testApp.deps.db, {
      districtId: district.id,
      retiredAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    const { auth } = await viewer([district.id]);
    expect(idsOf(await pageOf(auth))).toEqual([seat.id]);
    expect(idsOf(await pageOf(auth, { scope: 'nation' }))).toEqual([seat.id]);
    expect(idsOf(await pageOf(auth, { scope: 'state', state: 'ZZ' }))).toEqual([seat.id]);
  });

  it('with one, placeholders come last', async () => {
    const jurisdiction = await insertJurisdiction(testApp.deps.db);
    const seats = [];
    const placeholders = [];
    for (let n = 0; n < 3; n += 1) {
      seats.push(
        await insertOffice(testApp.deps.db, {
          jurisdictionId: jurisdiction.id,
          payAnnualCents: (n + 1) * 100_000,
        }),
      );
      placeholders.push(
        await insertOffice(testApp.deps.db, {
          jurisdictionId: jurisdiction.id,
          placeholder: true,
          payAnnualCents: 900_000,
        }),
      );
    }
    await insertOffice(testApp.deps.db, {
      jurisdictionId: jurisdiction.id,
      retiredAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    const { auth } = await viewer();
    for (const sort of ['pay', 'opportunity'] as const) {
      const expected = [
        ...expectedOrder(seats.map(fixtureOf), sort, 'set'),
        ...expectedOrder(placeholders.map(fixtureOf), sort, 'set'),
      ];
      const all = await pageOf(auth, { jurisdiction: jurisdiction.id, sort });
      expect(idsOf(all)).toEqual(expected);
      expect(all.total).toBe(6);
      // Pages of two cross the boundary between the last seat and the first placeholder.
      const pages = await allPages(auth, { jurisdiction: jurisdiction.id, sort, limit: '2' });
      expect(pages.flat()).toEqual(expected);
    }
  });

  it('district with includeContained', async () => {
    const county = await insertDistrict(testApp.deps.db);
    const fallback = await insertDistrictFallback(testApp.deps.db, { viaDistrictId: county.id });
    const countyOffice = await insertOffice(testApp.deps.db, { districtId: county.id });
    const special = await insertOffice(testApp.deps.db, { districtId: fallback.districtId });
    const { auth } = await viewer();
    const contained = await pageOf(auth, { district: county.id, includeContained: 'true' });
    expect(idsOf(contained).sort()).toEqual([countyOffice.id, special.id].sort());
    expect(idsOf(await pageOf(auth, { district: county.id }))).toHaveLength(2);
    const own = await pageOf(auth, { district: county.id, includeContained: 'false' });
    expect(idsOf(own)).toEqual([countyOffice.id]);
    expect(own.total).toBe(1);
  });

  it("the viewer's flags come from the same query", async () => {
    const one = await insertDistrict(testApp.deps.db);
    const many = await insertDistrict(testApp.deps.db);
    await insertOffice(testApp.deps.db, { districtId: one.id });
    const manyOffices = [];
    for (let n = 0; n < 20; n += 1) {
      manyOffices.push(await insertOffice(testApp.deps.db, { districtId: many.id }));
    }
    const { userId, auth } = await viewer([one.id]);
    const { auth: manyAuth, userId: manyUser } = await viewer([many.id]);
    const followed = manyOffices[3];
    const saved = manyOffices[7];
    if (followed === undefined || saved === undefined) {
      throw new Error('The fixture is short.');
    }
    await insertFollow(testApp.deps.db, { followerId: manyUser, targetId: followed.id });
    await insertBookmark(testApp.deps.db, { userId: manyUser, officeId: saved.id });
    expect(userId).not.toBe(manyUser);
    expect((await pageOf(auth)).items).toHaveLength(1);
    const forOne = testApp.statementCount();
    const page = await pageOf(manyAuth);
    expect(page.items).toHaveLength(20);
    expect(testApp.statementCount()).toBe(forOne);
    for (const item of page.items) {
      expect(item.viewer.following, item.id).toBe(item.id === followed.id);
      expect(item.viewer.bookmarked, item.id).toBe(item.id === saved.id);
    }
  });

  it('no query per item', async () => {
    const district = await insertDistrict(testApp.deps.db);
    for (let n = 0; n < 20; n += 1) {
      await insertOffice(testApp.deps.db, { districtId: district.id });
    }
    const { auth } = await viewer([district.id]);
    // The session's first request also marks it seen; measure the requests after it.
    await pageOf(auth, { limit: '1' });
    await pageOf(auth, { limit: '1' });
    const forOne = testApp.statementCount();
    await pageOf(auth, { limit: '20' });
    expect(testApp.statementCount()).toBe(forOne);
  });

  it('6,000 offices in one jurisdiction answer 422 area_too_large', async () => {
    const { db } = testApp.deps;
    const jurisdiction = await insertJurisdiction(db);
    const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id });
    const [type] = await db.execute<{ id: string }>(
      sql`select id from office_types order by id limit 1`,
      'objects',
    );
    if (type === undefined) {
      throw new Error('No office type.');
    }
    for (let start = 0; start < 6_000; start += BATCH) {
      await db.insert(offices).values(
        Array.from({ length: BATCH }, () =>
          makeOffice({
            officeTypeId: type.id,
            jurisdictionId: jurisdiction.id,
            districtId: district.id,
            state: 'ZZ',
          }),
        ),
      );
    }
    const { auth } = await viewer([district.id]);
    await expectEnvelope(await list(auth, { jurisdiction: jurisdiction.id }), 'area_too_large');
    await expectEnvelope(await list(auth, { district: district.id }), 'area_too_large');
    await expectEnvelope(await list(auth), 'area_too_large');
  });

  it('total', async () => {
    const district = await insertDistrict(testApp.deps.db);
    for (let n = 0; n < 7; n += 1) {
      await insertOffice(testApp.deps.db, {
        districtId: district.id,
        payAnnualCents: n * 100_000,
        nextFilingDeadline: plus(TODAY, n + 1),
      });
    }
    const { auth } = await viewer([district.id]);
    const mine = await pageOf(auth, { limit: '2' });
    expect(mine.total).toBe(7);
    expect((await pageOf(auth, { limit: '2', minPay: '300000' })).total).toBe(4);
    expect((await pageOf(auth, { district: district.id, limit: '3' })).total).toBe(7);
    expect((await pageOf(auth, { district: district.id, minPay: '600000' })).total).toBe(1);
    expect((await pageOf(auth, { cursor: mine.nextCursor ?? '', limit: '2' })).total).toBeNull();
    expect((await pageOf(auth, { deadlineWithin: '30' })).total).toBeNull();
    expect((await pageOf(auth, { scope: 'state', state: 'ZZ' })).total).toBeNull();
    expect((await pageOf(auth, { scope: 'nation' })).total).toBeNull();
    // No match on the set path counts 0.
    expect(await pageOf(auth, { minPay: '90000000' })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('scope state without a state uses the viewer state', async () => {
    const zy = await sortFixture('ZY', 3, 0);
    const zx = await sortFixture('ZX', 2, 0);
    const zyDistricts = [...new Set(zy.map((row) => row.districtId))];
    const { auth } = await viewer([...zyDistricts.slice(0, 2), zx[0]?.districtId ?? '']);
    const page = await pageOf(auth, { scope: 'state' });
    expect(idsOf(page)).toEqual(expectedOrder(zy.map(fixtureOf), 'opportunity', 'ranked'));
    expect(page.total).toBeNull();
  });

  it('scope state answers 400 for a viewer with no districts', async () => {
    const { auth } = await viewer();
    await expectEnvelope(await list(auth, { scope: 'state' }), 'invalid_request', {
      state: 'required',
    });
  });

  it('an unknown state answers 400', async () => {
    const { auth } = await viewer();
    await expectEnvelope(await list(auth, { state: 'QQ' }), 'invalid_request', {
      state: 'invalid_value',
    });
    await expectEnvelope(await list(auth, { scope: 'nation', state: 'QQ' }), 'invalid_request', {
      state: 'invalid_value',
    });
  });

  it("a malformed cursor and another sort's cursor answer 400 invalid_cursor", async () => {
    const district = await insertDistrict(testApp.deps.db);
    for (let n = 0; n < 3; n += 1) {
      await insertOffice(testApp.deps.db, { districtId: district.id, payAnnualCents: n });
    }
    const { auth } = await viewer([district.id]);
    const first = await pageOf(auth, { sort: 'pay', limit: '1' });
    const cursor = first.nextCursor ?? '';
    expect(cursor).not.toBe('');
    expect((await pageOf(auth, { sort: 'pay', limit: '1', cursor })).items).toHaveLength(1);
    await expectEnvelope(await list(auth, { sort: 'ease', cursor }), 'invalid_cursor');
    await expectEnvelope(await list(auth, { cursor }), 'invalid_cursor');
    await expectEnvelope(await list(auth, { sort: 'pay', cursor: `${cursor}!` }), 'invalid_cursor');
    const tampered = Buffer.from(
      JSON.stringify({ v: 1, s: 'pay', k: 1, id: 'x', p: false }),
    ).toString('base64url');
    await expectEnvelope(await list(auth, { sort: 'pay', cursor: tampered }), 'invalid_cursor');
  });
});
