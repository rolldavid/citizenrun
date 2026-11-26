import { asc, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import { offices } from '../schema/civic.ts';
import { officeTypes } from '../schema/reference.ts';
import {
  getTestDb,
  insertDistrict,
  insertDistrictFallback,
  insertJurisdiction,
  insertOffice,
  insertUser,
  makeOffice,
  setUserDistricts,
} from '../testing/index.ts';
import {
  SET_PATH_MAX,
  countSetCandidates,
  officeListRankedPage,
  officeListSetPage,
} from './civic.ts';
import type {
  OfficeListAfter,
  OfficeListFilters,
  OfficeListRow,
  OfficeListSet,
  OfficeListSort,
} from './civic.ts';
import { refreshOfficeSearch } from './office-search.ts';

// L-office-list's statements on factory rows of the fixture states; Pago Pago's date is fixed.
const TODAY = '2027-03-05';
const BATCH = 1_000;

const NO_FILTERS: OfficeListFilters = {
  issueIds: null,
  levels: null,
  officeTypeIds: null,
  jurisdictionKinds: null,
  minPayCents: null,
  fitsDayJob: false,
  maxHours: null,
  deadlineWithinDays: null,
  q: null,
};

const NO_SET: OfficeListSet = {
  mineUserId: null,
  districtId: null,
  includeContained: true,
  jurisdictionId: null,
  state: null,
};

function plus(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  return new Date(at.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function setPage(
  db: Db,
  input: {
    set: Partial<OfficeListSet>;
    keepPlaceholders?: boolean;
    filters?: Partial<OfficeListFilters>;
    sort?: OfficeListSort;
    after?: OfficeListAfter;
    limit?: number;
    withTotal?: boolean;
  },
): Promise<OfficeListRow[]> {
  const set = { ...NO_SET, ...input.set };
  return officeListSetPage(db, {
    set,
    keepPlaceholders:
      input.keepPlaceholders ?? (set.districtId !== null || set.jurisdictionId !== null),
    filters: { ...NO_FILTERS, ...input.filters },
    sort: input.sort ?? 'opportunity',
    todayPagoPago: TODAY,
    after: input.after ?? null,
    limit: input.limit ?? 50,
    withTotal: input.withTotal ?? false,
  });
}

function idsOf(rows: readonly OfficeListRow[]): string[] {
  return rows.map((row) => row.id);
}

function afterOf(row: OfficeListRow | undefined): OfficeListAfter {
  if (row === undefined) {
    throw new Error('No row to continue after.');
  }
  return { k: row.k, id: row.id, p: row.p };
}

/** Every page of the set path, `limit` at a time. */
async function allSetPages(
  db: Db,
  input: { set: Partial<OfficeListSet>; sort: OfficeListSort; limit: number },
): Promise<string[][]> {
  const pages: string[][] = [];
  let after: OfficeListAfter = null;
  for (;;) {
    const rows = await setPage(db, { ...input, after });
    const page = rows.slice(0, input.limit);
    pages.push(idsOf(page));
    if (rows.length <= input.limit) {
      return pages;
    }
    after = afterOf(page.at(-1));
  }
}

async function firstOfficeType(db: Db): Promise<string> {
  const [row] = await db
    .select({ id: officeTypes.id })
    .from(officeTypes)
    .orderBy(asc(officeTypes.id))
    .limit(1);
  if (row === undefined) {
    throw new Error('No office type.');
  }
  return row.id;
}

async function addStates(db: Db, states: readonly string[]): Promise<void> {
  for (const state of states) {
    await db.execute(sql`insert into state_rules (state) values (${state}) on conflict do nothing`);
  }
}

/** Ids sorted by a nullable number descending, nulls last, ties by id. */
function byDescNullsLast(rows: ReadonlyArray<{ id: string; value: number | null }>): string[] {
  return [...rows]
    .sort((a, b) => {
      if (a.value !== b.value) {
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return b.value - a.value;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((row) => row.id);
}

describe('L-office-list statements', () => {
  it('the set predicate intersects its parts', async () => {
    const db = getTestDb();
    const county = await insertJurisdiction(db);
    const other = await insertJurisdiction(db);
    const mine = await insertDistrict(db, { jurisdictionId: county.id });
    const mineElsewhere = await insertDistrict(db, { jurisdictionId: other.id });
    const notMine = await insertDistrict(db, { jurisdictionId: county.id });
    const both = await insertOffice(db, { districtId: mine.id });
    await insertOffice(db, { districtId: mineElsewhere.id });
    await insertOffice(db, { districtId: notMine.id });
    const user = await insertUser(db);
    await setUserDistricts(db, user.id, [mine.id, mineElsewhere.id]);
    const rows = await setPage(db, { set: { mineUserId: user.id, jurisdictionId: county.id } });
    expect(idsOf(rows)).toEqual([both.id]);
    expect(
      (await setPage(db, { set: { mineUserId: user.id }, keepPlaceholders: false })).length,
    ).toBe(2);
  });

  it('include contained adds fallback districts', async () => {
    const db = getTestDb();
    const county = await insertDistrict(db);
    const fallback = await insertDistrictFallback(db, { viaDistrictId: county.id });
    const countyOffice = await insertOffice(db, { districtId: county.id });
    const specialOffice = await insertOffice(db, { districtId: fallback.districtId });
    const contained = await setPage(db, { set: { districtId: county.id, includeContained: true } });
    expect(idsOf(contained).sort()).toEqual([countyOffice.id, specialOffice.id].sort());
    const own = await setPage(db, { set: { districtId: county.id, includeContained: false } });
    expect(idsOf(own)).toEqual([countyOffice.id]);
  });

  it('placeholders only with a district or jurisdiction', async () => {
    const db = getTestDb();
    const district = await insertDistrict(db);
    const seat = await insertOffice(db, { districtId: district.id });
    const placeholder = await insertOffice(db, { districtId: district.id, placeholder: true });
    await insertOffice(db, {
      districtId: district.id,
      retiredAt: new Date('2027-01-01T00:00:00Z'),
    });
    const user = await insertUser(db);
    await setUserDistricts(db, user.id, [district.id]);
    expect(
      idsOf(await setPage(db, { set: { mineUserId: user.id }, keepPlaceholders: false })),
    ).toEqual([seat.id]);
    // Kept with the district, and last whatever the sort.
    for (const sort of ['opportunity', 'pay', 'deadline'] as const) {
      expect(idsOf(await setPage(db, { set: { districtId: district.id }, sort }))).toEqual([
        seat.id,
        placeholder.id,
      ]);
    }
    expect(
      await countSetCandidates(db, {
        set: { ...NO_SET, districtId: district.id },
        keepPlaceholders: true,
      }),
    ).toBe(2);
    expect(
      await countSetCandidates(db, {
        set: { ...NO_SET, mineUserId: user.id },
        keepPlaceholders: false,
      }),
    ).toBe(1);
  });

  it('candidates are counted up to 5,001', async () => {
    const db = getTestDb();
    const jurisdiction = await insertJurisdiction(db);
    const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id });
    const officeTypeId = await firstOfficeType(db);
    const total = SET_PATH_MAX + 200;
    for (let start = 0; start < total; start += BATCH) {
      const rows = Array.from({ length: Math.min(BATCH, total - start) }, () =>
        makeOffice({
          officeTypeId,
          jurisdictionId: jurisdiction.id,
          districtId: district.id,
          state: 'ZZ',
        }),
      );
      await db.insert(offices).values(rows);
    }
    const set = { ...NO_SET, jurisdictionId: jurisdiction.id };
    expect(await countSetCandidates(db, { set, keepPlaceholders: true })).toBe(SET_PATH_MAX + 1);
  });

  it('each filter excludes nulls', async () => {
    const db = getTestDb();
    const district = await insertDistrict(db);
    const paid = await insertOffice(db, {
      districtId: district.id,
      payAnnualCents: 600_000,
      hoursPerWeek: '5',
    });
    await insertOffice(db, {
      districtId: district.id,
      payAnnualCents: 100_000,
      hoursPerWeek: '30',
    });
    await insertOffice(db, { districtId: district.id, payAnnualCents: null, hoursPerWeek: null });
    const set = { districtId: district.id };
    expect(idsOf(await setPage(db, { set, filters: { minPayCents: 500_000 } }))).toEqual([paid.id]);
    expect(idsOf(await setPage(db, { set, filters: { maxHours: 10 } }))).toEqual([paid.id]);
    // Zero is still a bound: an unknown pay never matches it.
    expect((await setPage(db, { set, filters: { minPayCents: 0 } })).length).toBe(2);
  });

  it('fitsDayJob keeps yes and likely', async () => {
    const db = getTestDb();
    const district = await insertDistrict(db);
    const yes = await insertOffice(db, { districtId: district.id, fitsDayJob: 'yes' });
    const likely = await insertOffice(db, { districtId: district.id, fitsDayJob: 'likely' });
    await insertOffice(db, { districtId: district.id, fitsDayJob: 'no' });
    await insertOffice(db, { districtId: district.id, fitsDayJob: null });
    const set = { districtId: district.id };
    expect(idsOf(await setPage(db, { set, filters: { fitsDayJob: true } })).sort()).toEqual(
      [yes.id, likely.id].sort(),
    );
    expect((await setPage(db, { set, filters: { fitsDayJob: false } })).length).toBe(4);
  });

  it('q matches the search vector and the title', async () => {
    const db = getTestDb();
    const district = await insertDistrict(db);
    const vector = await insertOffice(db, {
      districtId: district.id,
      title: 'Fixture County Treasurer',
    });
    await refreshOfficeSearch(db, [vector.id]);
    const trigram = await insertOffice(db, { districtId: district.id, title: 'Fixture Treasurr' });
    const other = await insertOffice(db, { districtId: district.id, title: 'Fixture Coroner' });
    await refreshOfficeSearch(db, [other.id]);
    const rows = await setPage(db, {
      set: { districtId: district.id },
      filters: { q: 'treasurer' },
    });
    expect(idsOf(rows).sort()).toEqual([vector.id, trigram.id].sort());
  });

  it('the descending keyset puts nulls last and breaks ties by id', async () => {
    const db = getTestDb();
    const district = await insertDistrict(db);
    const pays = [500, null, 300, 500];
    const made = [];
    for (const pay of pays) {
      const office = await insertOffice(db, { districtId: district.id, payAnnualCents: pay });
      made.push({ id: office.id, value: pay });
    }
    const expected = byDescNullsLast(made);
    const pages = await allSetPages(db, {
      set: { districtId: district.id, includeContained: false },
      sort: 'pay',
      limit: 2,
    });
    expect(pages).toEqual([expected.slice(0, 2), expected.slice(2, 4)]);
    // The null row comes last.
    const last = made.find((row) => row.value === null);
    expect(expected.at(-1)).toBe(last?.id);
  });

  it('the ascending deadline key treats a stale deadline as unknown on the set path', async () => {
    const db = getTestDb();
    const district = await insertDistrict(db);
    const soon = await insertOffice(db, {
      districtId: district.id,
      nextFilingDeadline: plus(TODAY, 3),
    });
    const later = await insertOffice(db, {
      districtId: district.id,
      nextFilingDeadline: plus(TODAY, 30),
    });
    const stale = await insertOffice(db, {
      districtId: district.id,
      nextFilingDeadline: plus(TODAY, -1),
    });
    const unknown = await insertOffice(db, { districtId: district.id, nextFilingDeadline: null });
    const rows = await setPage(db, { set: { districtId: district.id }, sort: 'deadline' });
    const tail = [stale.id, unknown.id].sort();
    expect(idsOf(rows)).toEqual([soon.id, later.id, ...tail]);
    expect(rows.map((row) => row.k)).toEqual([plus(TODAY, 3), plus(TODAY, 30), null, null]);
    // Paging one at a time returns the same order.
    const pages = await allSetPages(db, {
      set: { districtId: district.id },
      sort: 'deadline',
      limit: 1,
    });
    expect(pages.flat()).toEqual([soon.id, later.id, ...tail]);
  });

  it('the ranked path reads one state or many', async () => {
    const db = getTestDb();
    const states = ['ZX', 'ZY', 'ZZ'] as const;
    await addStates(db, ['ZX', 'ZY']);
    const made: Array<{ id: string; value: number | null; state: string }> = [];
    const values = [700, null, 200, 700, 50, null, 900];
    let index = 0;
    for (const state of states) {
      const jurisdiction = await insertJurisdiction(db, { state });
      for (let n = 0; n < 4; n += 1) {
        const value = values[index % values.length] ?? null;
        index += 1;
        const office = await insertOffice(db, {
          jurisdictionId: jurisdiction.id,
          payAnnualCents: value,
        });
        made.push({ id: office.id, value, state });
      }
      await insertOffice(db, { jurisdictionId: jurisdiction.id, placeholder: true });
    }
    const page = async (inStates: readonly string[], after: OfficeListAfter, limit: number) =>
      officeListRankedPage(db, {
        states: inStates,
        filters: NO_FILTERS,
        sort: 'pay',
        todayPagoPago: TODAY,
        after,
        limit,
      });
    const walk = async (inStates: readonly string[]): Promise<string[]> => {
      const seen: string[] = [];
      let after: OfficeListAfter = null;
      for (;;) {
        const rows = await page(inStates, after, 5);
        expect(rows.every((row) => row.total === null)).toBe(true);
        const kept = rows.slice(0, 5);
        seen.push(...idsOf(kept));
        if (rows.length <= 5) {
          return seen;
        }
        after = afterOf(kept.at(-1));
      }
    };
    expect(await walk(['ZY'])).toEqual(byDescNullsLast(made.filter((row) => row.state === 'ZY')));
    expect(await walk([...states])).toEqual(byDescNullsLast(made));
  });

  it('total counts every match before the limit', async () => {
    const db = getTestDb();
    const district = await insertDistrict(db);
    for (let n = 0; n < 5; n += 1) {
      await insertOffice(db, { districtId: district.id, payAnnualCents: n * 100_000 });
    }
    await insertOffice(db, { districtId: district.id, placeholder: true });
    const rows = await setPage(db, { set: { districtId: district.id }, limit: 2, withTotal: true });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.total)).toEqual([6, 6, 6]);
    const filtered = await setPage(db, {
      set: { districtId: district.id },
      filters: { minPayCents: 200_000 },
      limit: 1,
      withTotal: true,
    });
    expect(filtered[0]?.total).toBe(3);
    const without = await setPage(db, { set: { districtId: district.id }, limit: 2 });
    expect(without.map((row) => row.total)).toEqual([null, null, null]);
  });
});
