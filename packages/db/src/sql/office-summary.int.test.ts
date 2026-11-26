import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import { offices } from '../schema/civic.ts';
import { districts } from '../schema/geo.ts';
import { issues, officeTypes } from '../schema/reference.ts';
import {
  getTestDb,
  insertBookmark,
  insertDistrict,
  insertElection,
  insertFilingTrack,
  insertFollow,
  insertJurisdiction,
  insertOffice,
  insertOfficeholder,
  insertPerson,
  insertUser,
  setOfficeIssues,
  setUserIssues,
} from '../testing/index.ts';
import { officeSummaryRows } from './civic.ts';
import type { OfficeSummaryRow } from './civic.ts';

// Every row is a factory row of the fixture state ZZ; Pago Pago's date is fixed.
const TODAY = '2027-03-05';
const RETIRED = new Date('2027-01-01T00:00:00.000Z');

/** The calendar date `days` after `date`. */
function plus(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  return new Date(at.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

async function rowsFor(
  db: Db,
  officeIds: readonly string[],
  viewerId: string | null = null,
): Promise<Map<string, OfficeSummaryRow>> {
  const rows = await officeSummaryRows(db, {
    officeIds,
    viewerId,
    singleIssueId: null,
    todayPagoPago: TODAY,
  });
  return new Map(rows.map((row) => [row.id, row]));
}

async function rowFor(
  db: Db,
  officeId: string,
  viewerId: string | null = null,
): Promise<OfficeSummaryRow> {
  const row = (await rowsFor(db, [officeId], viewerId)).get(officeId);
  if (row === undefined) {
    throw new Error('The office summary query returned no row for the office.');
  }
  return row;
}

async function issueIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: issues.id }).from(issues).orderBy(asc(issues.sort));
  return rows.map((row) => row.id);
}

function at(list: readonly string[], index: number): string {
  const value = list[index];
  if (value === undefined) {
    throw new Error('The fixture list is too short.');
  }
  return value;
}

describe('officeSummaryRows', () => {
  it('one row per office with the joins', async () => {
    const db = getTestDb();
    const jurisdiction = await insertJurisdiction(db, {
      kind: 'city',
      name: 'Fixture City',
      website: 'https://example.test/fixture-city',
      timezone: 'America/Chicago',
    });
    const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id, level: 'local' });
    const first = await insertOffice(db, { districtId: district.id });
    const second = await insertOffice(db, { districtId: district.id, title: 'Fixture Board' });
    const rows = await rowsFor(db, [first.id, second.id]);
    expect(rows.size).toBe(2);
    const [type] = await db
      .select({ level: officeTypes.level, electorate: officeTypes.electorate })
      .from(officeTypes)
      .where(eq(officeTypes.id, first.officeTypeId));
    const [stored] = await db
      .select({ outlineSvg: districts.outlineSvg, outlineBbox: districts.outlineBbox })
      .from(districts)
      .where(eq(districts.id, district.id));
    for (const office of [first, second]) {
      const row = rows.get(office.id);
      expect(row).toMatchObject({
        id: office.id,
        slug: office.slug,
        title: office.title,
        officeTypeId: office.officeTypeId,
        level: type?.level,
        electorate: type?.electorate,
        state: 'ZZ',
        placeholder: false,
        seats: 1,
        retiredAt: null,
        jurisdictionId: jurisdiction.id,
        jurisdictionName: 'Fixture City',
        jurisdictionKind: 'city',
        jurisdictionState: 'ZZ',
        jurisdictionWebsite: 'https://example.test/fixture-city',
        jurisdictionTimezone: 'America/Chicago',
        districtId: district.id,
        districtTileId: district.tileId,
        districtName: district.name,
        districtLevel: 'local',
        districtGeometryQuality: 'exact',
        districtOutlineSvg: stored?.outlineSvg,
        districtOutlineBbox: stored?.outlineBbox,
      });
      expect(row?.districtOutlineSvg).not.toBeNull();
      expect(row?.districtOutlineBbox).toHaveLength(4);
      // Geometry is never selected.
      expect(Object.keys(row ?? {}).filter((key) => /geom$|labelPoint/i.test(key))).toEqual([]);
    }
  });

  it('a retired office is returned with its retirement time', async () => {
    const db = getTestDb();
    const office = await insertOffice(db, { retiredAt: RETIRED });
    expect((await rowFor(db, office.id)).retiredAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('viewer flags come from follows and bookmarks', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    const other = await insertOffice(db);
    const viewer = await insertUser(db);
    const stranger = await insertUser(db);
    await insertFollow(db, { followerId: viewer.id, targetType: 'office', targetId: office.id });
    await insertBookmark(db, { userId: viewer.id, officeId: office.id });
    expect(await rowFor(db, office.id, viewer.id)).toMatchObject({
      following: true,
      bookmarked: true,
    });
    expect(await rowFor(db, other.id, viewer.id)).toMatchObject({
      following: false,
      bookmarked: false,
    });
    expect(await rowFor(db, office.id, stranger.id)).toMatchObject({
      following: false,
      bookmarked: false,
    });
    expect(await rowFor(db, office.id, null)).toMatchObject({
      following: false,
      bookmarked: false,
      hasIssues: false,
    });
  });

  it("chips put the viewer's issues first, then relevance, then issue order", async () => {
    const db = getTestDb();
    const ids = await issueIds(db);
    const office = await insertOffice(db);
    await setOfficeIssues(db, office.id, [
      { issueId: at(ids, 3), relevance: 3 },
      { issueId: at(ids, 2), relevance: 2 },
      { issueId: at(ids, 1), relevance: 2 },
      { issueId: at(ids, 0), relevance: 1 },
    ]);
    const viewer = await insertUser(db);
    await setUserIssues(db, viewer.id, [{ issueId: at(ids, 0) }]);
    const row = await rowFor(db, office.id, viewer.id);
    expect(row.hasIssues).toBe(true);
    expect(row.issues).toEqual([
      { issueId: at(ids, 0), relevance: 1 },
      { issueId: at(ids, 3), relevance: 3 },
      { issueId: at(ids, 1), relevance: 2 },
    ]);
    expect((await rowFor(db, office.id, null)).issues).toEqual([
      { issueId: at(ids, 3), relevance: 3 },
      { issueId: at(ids, 1), relevance: 2 },
      { issueId: at(ids, 2), relevance: 2 },
    ]);
    const bare = await insertOffice(db);
    expect((await rowFor(db, bare.id, viewer.id)).issues).toEqual([]);
  });

  it('the headline issue weighs starred issues', async () => {
    const db = getTestDb();
    const ids = await issueIds(db);
    const x = at(ids, 4);
    const y = at(ids, 5);
    const viewer = await insertUser(db);
    await setUserIssues(db, viewer.id, [
      { issueId: x, starred: true },
      { issueId: y, starred: false },
    ]);
    // 0.9 * 2 = 1.8 against 0.7 * 3 = 2.1.
    const first = await insertOffice(db);
    await setOfficeIssues(db, first.id, [
      { issueId: x, relevance: 2 },
      { issueId: y, relevance: 3 },
    ]);
    // 0.9 * 3 = 2.7 against 0.7 * 3 = 2.1.
    const second = await insertOffice(db);
    await setOfficeIssues(db, second.id, [
      { issueId: x, relevance: 3 },
      { issueId: y, relevance: 3 },
    ]);
    const rows = await rowsFor(db, [first.id, second.id], viewer.id);
    expect(rows.get(first.id)?.headlineIssueId).toBe(y);
    expect(rows.get(second.id)?.headlineIssueId).toBe(x);
    expect((await rowFor(db, first.id, null)).headlineIssueId).toBeNull();
  });

  it('the strongest issue breaks ties by issue order', async () => {
    const db = getTestDb();
    const ids = await issueIds(db);
    const office = await insertOffice(db);
    await setOfficeIssues(db, office.id, [
      { issueId: at(ids, 6), relevance: 3 },
      { issueId: at(ids, 2), relevance: 3 },
      { issueId: at(ids, 0), relevance: 1 },
    ]);
    expect((await rowFor(db, office.id)).strongestIssueId).toBe(at(ids, 2));
    const bare = await insertOffice(db);
    expect((await rowFor(db, bare.id)).strongestIssueId).toBeNull();
  });

  it('a single office features its holder; a body features the holder up next', async () => {
    const db = getTestDb();
    const single = await insertOffice(db);
    const holder = await insertPerson(db);
    await insertOfficeholder(db, { officeId: single.id, personId: holder.id, since: '2023-01-02' });

    const body = await insertOffice(db, { seats: 1, bodySize: 7, seatsUpNext: 3 });
    const sitting = await insertPerson(db);
    const upNext = await insertPerson(db);
    const laterUpNext = await insertPerson(db);
    await insertOfficeholder(db, {
      officeId: body.id,
      personId: sitting.id,
      since: '2015-01-05',
      seatUpNext: false,
    });
    await insertOfficeholder(db, {
      officeId: body.id,
      personId: upNext.id,
      since: '2019-01-07',
      seatUpNext: true,
    });
    await insertOfficeholder(db, {
      officeId: body.id,
      personId: laterUpNext.id,
      since: '2021-01-04',
      seatUpNext: true,
    });

    const quietBody = await insertOffice(db, { seats: 1, bodySize: 5 });
    await insertOfficeholder(db, { officeId: quietBody.id, seatUpNext: false });
    await insertOfficeholder(db, { officeId: quietBody.id, seatUpNext: null });

    const pastOnly = await insertOffice(db);
    await insertOfficeholder(db, {
      officeId: pastOnly.id,
      since: '2015-01-05',
      until: '2019-01-07',
    });

    const rows = await rowsFor(db, [single.id, body.id, quietBody.id, pastOnly.id]);
    expect(rows.get(single.id)).toMatchObject({
      featuredPersonId: holder.id,
      featuredHolderSince: '2023-01-02',
    });
    expect(rows.get(body.id)).toMatchObject({
      featuredPersonId: upNext.id,
      featuredHolderSince: '2019-01-07',
    });
    expect(rows.get(quietBody.id)).toMatchObject({
      featuredPersonId: null,
      featuredHolderSince: null,
    });
    expect(rows.get(pastOnly.id)).toMatchObject({
      featuredPersonId: null,
      featuredHolderSince: null,
    });
  });

  it('open seat inputs', async () => {
    const db = getTestDb();
    const vacant = await insertOffice(db, { bodySize: 5, seatsUpNext: 2, vacantSeatsUpNext: 1 });
    const termLimited = await insertOffice(db);
    await insertOfficeholder(db, { officeId: termLimited.id, termLimited: true, notRunning: null });
    const notRunning = await insertOffice(db);
    await insertOfficeholder(db, { officeId: notRunning.id, termLimited: false, notRunning: true });
    const none = await insertOffice(db);
    // A body's holder whose seat is not up next counts for nothing.
    const body = await insertOffice(db, { bodySize: 5 });
    await insertOfficeholder(db, { officeId: body.id, seatUpNext: false, termLimited: true });
    const rows = await rowsFor(db, [vacant.id, termLimited.id, notRunning.id, none.id, body.id]);
    expect(rows.get(vacant.id)).toMatchObject({
      vacantSeatsUpNext: 1,
      upNextTermLimited: null,
      upNextNotRunning: null,
    });
    expect(rows.get(termLimited.id)).toMatchObject({
      vacantSeatsUpNext: null,
      upNextTermLimited: true,
      upNextNotRunning: null,
    });
    expect(rows.get(notRunning.id)).toMatchObject({
      upNextTermLimited: false,
      upNextNotRunning: true,
    });
    expect(rows.get(none.id)).toMatchObject({
      vacantSeatsUpNext: null,
      upNextTermLimited: null,
      upNextNotRunning: null,
    });
    expect(rows.get(body.id)).toMatchObject({ upNextTermLimited: null, upNextNotRunning: null });
  });

  it('the stored next election is the only candidate', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    await insertElection(db, {
      officeId: office.id,
      electionDate: plus(TODAY, 60),
      kind: 'primary',
      filingDeadline: plus(TODAY, 1),
    });
    const stored = await insertElection(db, {
      officeId: office.id,
      electionDate: plus(TODAY, 200),
      filingDeadline: plus(TODAY, 90),
    });
    await db.update(offices).set({ nextElectionId: stored.id }).where(eq(offices.id, office.id));
    const row = await rowFor(db, office.id);
    expect(row.nextElectionId).toBe(stored.id);
    expect(row.electionCandidates.map((candidate) => candidate.id)).toEqual([stored.id]);
  });

  it('candidates cover the two uncertain days and the first certain one', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    const election = (days: number, kind: 'general' | 'primary' | 'special' = 'general') =>
      insertElection(db, {
        officeId: office.id,
        kind,
        electionDate: plus(TODAY, 60 + days),
        filingDeadline: plus(TODAY, days),
      });
    const today = await election(0);
    const tomorrow = await election(1);
    const certain = await election(2);
    await election(30);
    await insertElection(db, {
      officeId: office.id,
      kind: 'special',
      electionDate: plus(TODAY, 61),
      filingDeadline: TODAY,
      retiredAt: RETIRED,
    });
    await insertElection(db, {
      officeId: office.id,
      kind: 'primary',
      electionDate: plus(TODAY, 20),
      filingDeadline: plus(TODAY, -1),
    });
    // A runoff with no deadline inside the uncertain days, and one that would sort first among the
    // later elections: neither is a candidate.
    await insertElection(db, {
      officeId: office.id,
      kind: 'primary_runoff',
      electionDate: plus(TODAY, 1),
      filingDeadline: null,
    });
    await insertElection(db, {
      officeId: office.id,
      kind: 'general_runoff',
      electionDate: plus(TODAY, 2),
      filingDeadline: null,
    });
    const row = await rowFor(db, office.id);
    expect(row.electionCandidates.map((candidate) => candidate.id).sort()).toEqual(
      [today.id, tomorrow.id, certain.id].sort(),
    );
    const first = row.electionCandidates.find((candidate) => candidate.id === today.id);
    expect(first).toEqual({
      id: today.id,
      election_date: plus(TODAY, 60),
      kind: 'general',
      party: null,
      filing_opens: null,
      filing_deadline: TODAY,
      filing_deadline_time: null,
      proof: null,
    });
    const bare = await insertOffice(db);
    expect((await rowFor(db, bare.id)).electionCandidates).toEqual([]);
  });

  it('the headline track proof prefers the stored closes_on entry', async () => {
    const db = getTestDb();
    const checkedAt = new Date('2027-02-01T08:00:00.123Z');
    const storedEntry = {
      source_url: 'https://example.test/fixture-closes-on',
      quote: 'Fixture closing quote.',
      confidence: 'medium',
      checked_at: '2027-02-02T09:00:00.000Z',
    };
    const proofOf = async (
      tracks: readonly Parameters<typeof insertFilingTrack>[1][],
    ): Promise<unknown> => {
      const office = await insertOffice(db);
      const election = await insertElection(db, {
        officeId: office.id,
        electionDate: plus(TODAY, 90),
      });
      for (const track of tracks) {
        await insertFilingTrack(db, { opensOn: TODAY, ...track, electionId: election.id });
      }
      const [candidate] = (await rowFor(db, office.id)).electionCandidates;
      expect(candidate?.filing_deadline).toBe(plus(TODAY, 10));
      return candidate?.proof;
    };

    expect(
      await proofOf([
        { closesOn: plus(TODAY, 10), checkedAt, fieldMeta: { closes_on: storedEntry } },
      ]),
    ).toEqual(storedEntry);
    expect(
      await proofOf([
        {
          closesOn: plus(TODAY, 10),
          checkedAt,
          sourceUrl: 'https://example.test/fixture-track',
          quote: 'Fixture track quote.',
          confidence: 'high',
          ruleCitation: 'Fixture Code 1-2-3',
        },
      ]),
    ).toEqual({
      source_url: 'https://example.test/fixture-track',
      quote: 'Fixture track quote.',
      confidence: 'high',
      checked_at: '2027-02-01T08:00:00.123Z',
      rule_citation: 'Fixture Code 1-2-3',
    });
    // Two tracks closing the same day: the one with the stated hour (D-330).
    expect(
      await proofOf([
        {
          track: 'nonpartisan',
          closesOn: plus(TODAY, 10),
          closesTime: null,
          checkedAt,
          sourceUrl: 'https://example.test/fixture-no-hour',
        },
        {
          track: 'independent',
          closesOn: plus(TODAY, 10),
          closesTime: '17:00',
          checkedAt,
          sourceUrl: 'https://example.test/fixture-hour',
        },
      ]),
    ).toMatchObject({ source_url: 'https://example.test/fixture-hour' });
    // A null citation is left out, never sent as null.
    const uncited = await proofOf([{ closesOn: plus(TODAY, 10), checkedAt, ruleCitation: null }]);
    expect(uncited).toEqual({
      source_url: 'https://example.test/fixture-source',
      quote: 'Fixture quote.',
      confidence: 'medium',
      checked_at: '2027-02-01T08:00:00.123Z',
    });
    expect(Object.hasOwn(uncited as object, 'rule_citation')).toBe(false);
  });

  it('the headline time is sent as HH:MM', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    const election = await insertElection(db, {
      officeId: office.id,
      electionDate: plus(TODAY, 90),
    });
    await insertFilingTrack(db, {
      electionId: election.id,
      opensOn: TODAY,
      closesOn: plus(TODAY, 10),
      closesTime: '12:00',
    });
    const [candidate] = (await rowFor(db, office.id)).electionCandidates;
    expect(candidate).toMatchObject({
      filing_opens: TODAY,
      filing_deadline: plus(TODAY, 10),
      filing_deadline_time: '12:00',
    });
  });

  it('the last election date ignores retired elections', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    await insertElection(db, { officeId: office.id, electionDate: '2027-11-02' });
    await insertElection(db, { officeId: office.id, electionDate: '2025-11-04' });
    await insertElection(db, {
      officeId: office.id,
      electionDate: '2028-11-07',
      retiredAt: RETIRED,
    });
    expect((await rowFor(db, office.id)).lastElectionDate).toBe('2027-11-02');
    const bare = await insertOffice(db);
    expect((await rowFor(db, bare.id)).lastElectionDate).toBeNull();
  });

  it('numbers arrive as numbers', async () => {
    const db = getTestDb();
    const office = await insertOffice(db, {
      payAnnualCents: 5294100,
      payAmountCents: 441175,
      hoursPerWeek: '20.5',
      filingFeeCents: 5000,
      ease: '62',
      effort: { hours: 120, dollars: 250000, assumptions: [] },
    });
    const row = await rowFor(db, office.id);
    expect(row.payAnnualCents).toBe(5294100);
    expect(row.payAmountCents).toBe(441175);
    expect(row.hoursPerWeek).toBe(20.5);
    expect(row.filingFeeCents).toBe(5000);
    expect(row.ease).toBe(62);
    expect(row.costToRunCents).toBe(250000);
    expect(typeof row.districtTileId).toBe('number');
    expect(Number.isSafeInteger(row.districtTileId)).toBe(true);
    for (const corner of row.districtOutlineBbox ?? []) {
      expect(typeof corner).toBe('number');
    }
    const bare = await rowFor(db, (await insertOffice(db)).id);
    expect(bare).toMatchObject({
      payAnnualCents: null,
      hoursPerWeek: null,
      filingFeeCents: null,
      costToRunCents: null,
      ease: null,
    });
  });

  it('an empty id list sends no statement', async () => {
    const db = getTestDb();
    let sent = 0;
    const counting = new Proxy(db, {
      get(target, property, receiver): unknown {
        if (property === 'execute') {
          return (...args: Parameters<Db['execute']>) => {
            sent += 1;
            return target.execute(...args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      await officeSummaryRows(counting, {
        officeIds: [],
        viewerId: null,
        singleIssueId: null,
        todayPagoPago: TODAY,
      }),
    ).toEqual([]);
    expect(sent).toBe(0);
    const office = await insertOffice(db);
    await officeSummaryRows(counting, {
      officeIds: [office.id],
      viewerId: null,
      singleIssueId: null,
      todayPagoPago: TODAY,
    });
    expect(sent).toBe(1);
  });
});
