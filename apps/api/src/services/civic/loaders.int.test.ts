import { issues, people } from '@citizenrun/db';
import {
  insertCandidacy,
  insertDistrict,
  insertElection,
  insertFilingTrack,
  insertFollow,
  insertJurisdiction,
  insertOffice,
  insertOfficeholder,
  insertPerson,
  insertResult,
  insertUser,
  setOfficeIssues,
  setUserIssues,
} from '@citizenrun/db/testing';
import {
  CandidacyViewSchema,
  ElectionViewSchema,
  OfficeSummarySchema,
  PersonSummarySchema,
  ResultViewSchema,
} from '@citizenrun/shared';
import { civicPhotoKey } from '@citizenrun/shared/storage';
import { FakeClock } from '@citizenrun/shared/testing';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import {
  civicReadContextOf,
  loadCandidacyViews,
  loadElectionViews,
  loadOfficeSummaries,
  loadPersonSummaries,
  loadResultViews,
} from './loaders.ts';
import { personSummaryRows } from './person-summary.ts';

// Noon on 2027-03-05 in Chicago. Every civic row is a factory row of the fixture state ZZ.
const NOW = new Date('2027-03-05T18:00:00.000Z');
const ZONE = 'America/Chicago';

const PROOF = {
  source_url: 'https://example.test/fixture-pay',
  quote: 'Fixture pay quote.',
  confidence: 'medium',
  checked_at: '2027-02-01T08:00:00.000Z',
} as const;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp({ clock: new FakeClock(NOW) });
});

function ctx() {
  return civicReadContextOf(testApp.deps);
}

async function issueIds(): Promise<string[]> {
  const rows = await testApp.deps.db
    .select({ id: issues.id })
    .from(issues)
    .orderBy(asc(issues.sort));
  return rows.map((row) => row.id);
}

function at(list: readonly string[], index: number): string {
  const value = list[index];
  if (value === undefined) {
    throw new Error('The fixture list is too short.');
  }
  return value;
}

/** An office of a Chicago-zoned fixture city. */
async function chicagoOffice(overrides: Parameters<typeof insertOffice>[1] = {}) {
  const db = testApp.deps.db;
  const jurisdiction = await insertJurisdiction(db, {
    kind: 'city',
    name: 'Fixture City',
    timezone: ZONE,
    website: 'https://example.test/fixture-city',
  });
  const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id, level: 'local' });
  return insertOffice(db, {
    jurisdictionId: jurisdiction.id,
    districtId: district.id,
    ...overrides,
  });
}

/** An election closing on 2027-04-01 at noon through one track with the given proof. */
async function electionWithTrack(
  officeId: string,
  track: Parameters<typeof insertFilingTrack>[1] = {},
) {
  const db = testApp.deps.db;
  const election = await insertElection(db, {
    officeId,
    kind: 'general',
    electionDate: '2027-06-01',
  });
  await insertFilingTrack(db, {
    electionId: election.id,
    opensOn: '2027-03-01',
    closesOn: '2027-04-01',
    closesTime: '12:00',
    sourceUrl: 'https://example.test/fixture-calendar',
    quote: 'Fixture calendar quote.',
    confidence: 'high',
    checkedAt: new Date('2027-02-03T10:00:00.000Z'),
    ruleCitation: 'Fixture Code 10-1',
    ...track,
  });
  return election;
}

async function summaryOf(
  officeId: string,
  viewerId: string | null = null,
  singleIssueId?: string | null,
) {
  const summaries = await loadOfficeSummaries(testApp.deps.db, {
    ids: [officeId],
    viewerId,
    now: NOW,
    ctx: ctx(),
    ...(singleIssueId === undefined ? {} : { singleIssueId }),
  });
  const summary = summaries.get(officeId);
  if (summary === undefined) {
    throw new Error('The loader left the office out.');
  }
  return summary;
}

describe('loadOfficeSummaries', () => {
  it('office summaries map every key', async () => {
    const db = testApp.deps.db;
    const ids = await issueIds();
    const office = await chicagoOffice({
      payAnnualCents: 5294100,
      payKind: 'salary',
      payAmountCents: 5294100,
      payPeriod: 'year',
      hoursPerWeek: '20',
      filingFeeCents: 5000,
      signaturesRequired: 25,
      fieldMeta: { pay_annual_cents: PROOF },
    });
    await electionWithTrack(office.id);
    await setOfficeIssues(db, office.id, [{ issueId: at(ids, 0), relevance: 2 }]);
    const holder = await insertPerson(db, {
      photoKey: civicPhotoKey('b'.repeat(64)),
      photoWidth: 320,
      photoHeight: 400,
      photoCredit: 'Fixture Credit',
    });
    await insertOfficeholder(db, { officeId: office.id, personId: holder.id, since: '2023-01-02' });
    const summary = await summaryOf(office.id);
    expect(OfficeSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      id: office.id,
      jurisdiction: { name: 'Fixture City', kind: 'city', state: 'ZZ', timezone: ZONE },
      payAnnualCents: 5294100,
      hoursPerWeek: 20,
      filingFeeCents: 5000,
      signaturesRequired: 25,
      impact: null,
      opportunity: null,
      issues: [{ issueId: at(ids, 0), relevance: 2 }],
      featuredHolderSince: '2023-01-02',
      openSeat: null,
      retiredAt: null,
      viewer: { following: false, bookmarked: false, running: false, declarationId: null },
    });
    expect(summary.outline?.svg).toEqual(expect.any(String));
    expect(summary.outline?.bbox).toHaveLength(4);
    expect(summary.featuredOfficeholder).toMatchObject({
      id: holder.id,
      photoCredit: 'Fixture Credit',
      photo: { kind: 'image', width: 320, height: 400, blurhash: null },
      rosterOnly: false,
      viewer: { following: false },
    });
  });

  it("the filing deadline is the next fileable election's", async () => {
    const office = await chicagoOffice();
    const election = await electionWithTrack(office.id);
    const summary = await summaryOf(office.id);
    expect(summary.nextElection).toEqual({
      id: election.id,
      electionDate: '2027-06-01',
      kind: 'general',
      party: null,
    });
    expect(summary.filingDeadline).toEqual({ date: '2027-04-01', time: '12:00', timezone: ZONE });
    expect(summary.filingStatus).toBe('open');
    expect(summary.fieldMeta.filingDeadline).toEqual({
      sourceUrl: 'https://example.test/fixture-calendar',
      quote: 'Fixture calendar quote.',
      confidence: 'high',
      checkedAt: '2027-02-03T10:00:00.000Z',
      ruleCitation: 'Fixture Code 10-1',
    });
  });

  it('a headline track with no rule citation still gives fieldMeta.filingDeadline', async () => {
    const office = await chicagoOffice();
    await electionWithTrack(office.id, { ruleCitation: null });
    const summary = await summaryOf(office.id);
    expect(summary.fieldMeta.filingDeadline).toMatchObject({
      confidence: 'high',
      ruleCitation: null,
    });
  });

  it('an office whose elections are all past has no election', async () => {
    const office = await chicagoOffice();
    await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: '2026-11-03',
      filingDeadline: '2026-08-01',
    });
    const summary = await summaryOf(office.id);
    expect(summary).toMatchObject({
      nextElection: null,
      filingDeadline: null,
      filingStatus: 'no_election',
    });
    expect(summary.fieldMeta.filingDeadline).toBeUndefined();
  });

  it('an office whose only upcoming election has no deadline shows dates not known', async () => {
    const office = await chicagoOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: '2027-11-02',
      filingDeadline: null,
    });
    const summary = await summaryOf(office.id);
    expect(summary.nextElection?.id).toBe(election.id);
    expect(summary.filingDeadline).toBeNull();
    expect(summary.filingStatus).toBe('dates_not_known');
    expect(summary.fieldMeta.filingDeadline).toBeUndefined();
  });

  it('an office with an election to come and nothing to file for is closed', async () => {
    const office = await chicagoOffice();
    await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: '2027-06-01',
      filingDeadline: '2027-03-01',
    });
    const summary = await summaryOf(office.id);
    expect(summary).toMatchObject({ nextElection: null, filingStatus: 'closed' });
  });

  it('every non-null act-on value has its proof and every null one none', async () => {
    const office = await chicagoOffice({
      payAnnualCents: 1200000,
      hoursPerWeek: '10',
      filingFeeCents: null,
      fieldMeta: { pay_annual_cents: PROOF, filing_fee_cents: PROOF },
    });
    const summary = await summaryOf(office.id);
    expect(summary.fieldMeta).toEqual({
      payAnnualCents: {
        sourceUrl: PROOF.source_url,
        quote: PROOF.quote,
        confidence: 'medium',
        checkedAt: PROOF.checked_at,
        ruleCitation: null,
      },
    });
  });

  it('an invalid stored proof is dropped and logged', async () => {
    const office = await chicagoOffice({
      payAnnualCents: 1200000,
      fieldMeta: {
        pay_annual_cents: {
          source_url: PROOF.source_url,
          quote: PROOF.quote,
          checked_at: PROOF.checked_at,
        },
      },
    });
    const before = testApp.logs.length;
    const summary = await summaryOf(office.id);
    expect(summary.fieldMeta.payAnnualCents).toBeUndefined();
    const lines = testApp.logs
      .slice(before)
      .filter((line) => line.parsed.event === 'civic.field_meta_invalid');
    expect(lines).toHaveLength(1);
    const fields = Object.keys(lines[0]?.parsed ?? {}).filter(
      (key) => !['time', 'level', 'service', 'event'].includes(key),
    );
    expect(fields).toEqual(['column']);
    expect(lines[0]?.parsed).toMatchObject({ level: 'warn', column: 'pay_annual_cents' });
  });

  it('logged out uses the strongest issue', async () => {
    const db = testApp.deps.db;
    const ids = await issueIds();
    const office = await chicagoOffice();
    await setOfficeIssues(db, office.id, [
      { issueId: at(ids, 2), relevance: 3 },
      { issueId: at(ids, 1), relevance: 1 },
    ]);
    expect(await summaryOf(office.id)).toMatchObject({
      impactMode: 'single_issue',
      impactIssueId: at(ids, 2),
      headlineIssueId: at(ids, 2),
    });
    expect(await summaryOf(office.id, null, at(ids, 1))).toMatchObject({
      impactMode: 'single_issue',
      impactIssueId: at(ids, 1),
      headlineIssueId: at(ids, 1),
    });
    const viewer = await insertUser(db);
    await setUserIssues(db, viewer.id, [{ issueId: at(ids, 1), starred: true }]);
    expect(await summaryOf(office.id, viewer.id)).toMatchObject({
      impactMode: 'personal',
      impactIssueId: null,
      headlineIssueId: at(ids, 1),
    });
  });

  it('a roster-only featured holder gives no featured officeholder', async () => {
    const db = testApp.deps.db;
    const office = await chicagoOffice();
    const director = await insertPerson(db, { rosterOnly: true });
    await insertOfficeholder(db, {
      officeId: office.id,
      personId: director.id,
      since: '2022-01-03',
    });
    expect(await summaryOf(office.id)).toMatchObject({
      featuredOfficeholder: null,
      featuredHolderSince: null,
    });
  });

  it('a retired office is returned with retiredAt set', async () => {
    const office = await chicagoOffice({ retiredAt: new Date('2027-01-01T00:00:00.000Z') });
    expect((await summaryOf(office.id)).retiredAt).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('person summaries', () => {
  /** A chain of `merges` merged people ending at a survivor; returns the head and the survivor. */
  async function mergeChain(merges: number) {
    const db = testApp.deps.db;
    const survivor = await insertPerson(db);
    let next = survivor.id;
    for (let hop = 0; hop < merges; hop += 1) {
      const merged = await insertPerson(db, {
        mergedInto: next,
        retiredAt: new Date('2027-01-01T00:00:00.000Z'),
      });
      next = merged.id;
    }
    return { head: next, survivor };
  }

  async function personOf(id: string, viewerId: string | null = null) {
    return (
      await loadPersonSummaries(testApp.deps.db, { ids: [id], viewerId, now: NOW, ctx: ctx() })
    ).get(id);
  }

  it('a merged person resolves to the survivor', async () => {
    const { head, survivor } = await mergeChain(1);
    const person = await personOf(head);
    expect(person?.id).toBe(survivor.id);
    expect(PersonSummarySchema.parse(person)).toEqual(person);
  });

  it('a chain of five merges resolves to the survivor', async () => {
    const { head, survivor } = await mergeChain(5);
    expect((await personOf(head))?.id).toBe(survivor.id);
  });

  it('a chain of six merges is left out', async () => {
    const { head } = await mergeChain(6);
    expect(await personOf(head)).toBeUndefined();
  });

  it('a merge cycle is left out', async () => {
    const db = testApp.deps.db;
    const first = await insertPerson(db);
    const second = await insertPerson(db, { mergedInto: first.id });
    await db.update(people).set({ mergedInto: second.id }).where(eq(people.id, first.id));
    expect(await personOf(first.id)).toBeUndefined();
    expect(await personOf(second.id)).toBeUndefined();
  });

  it('an unknown id is left out', async () => {
    const { survivor } = await mergeChain(0);
    const missing = '0195d2c4-0000-7000-8000-00000000abcd';
    const persons = await loadPersonSummaries(testApp.deps.db, {
      ids: [survivor.id, missing],
      viewerId: null,
      now: NOW,
      ctx: ctx(),
    });
    expect([...persons.keys()]).toEqual([survivor.id]);
  });

  it('a roster-only person is left out of the loader and kept when asked', async () => {
    const director = await insertPerson(testApp.deps.db, { rosterOnly: true });
    expect(await personOf(director.id)).toBeUndefined();
    const kept = await personSummaryRows(testApp.deps.db, {
      ids: [director.id],
      viewerId: null,
      includeRosterOnly: true,
      now: NOW,
      ctx: ctx(),
    });
    expect(kept.get(director.id)).toMatchObject({ id: director.id, rosterOnly: true });
  });

  it('a person follow and a follow of the claimed user both count', async () => {
    const db = testApp.deps.db;
    const viewer = await insertUser(db);
    const owner = await insertUser(db);
    const followed = await insertPerson(db);
    const claimed = await insertPerson(db, { claimedBy: owner.id });
    const other = await insertPerson(db);
    await insertFollow(db, { followerId: viewer.id, targetType: 'person', targetId: followed.id });
    await insertFollow(db, { followerId: viewer.id, targetType: 'user', targetId: owner.id });
    const persons = await loadPersonSummaries(db, {
      ids: [followed.id, claimed.id, other.id],
      viewerId: viewer.id,
      now: NOW,
      ctx: ctx(),
    });
    expect(persons.get(followed.id)?.viewer.following).toBe(true);
    expect(persons.get(claimed.id)).toMatchObject({ claimed: true, viewer: { following: true } });
    expect(persons.get(other.id)?.viewer.following).toBe(false);
    const loggedOut = await loadPersonSummaries(db, {
      ids: [followed.id, claimed.id],
      viewerId: null,
      now: NOW,
      ctx: ctx(),
    });
    expect(loggedOut.get(followed.id)?.viewer.following).toBe(false);
    expect(loggedOut.get(claimed.id)?.viewer.following).toBe(false);
  });
});

describe('loadElectionViews', () => {
  it('election views order tracks and carry their proof', async () => {
    const db = testApp.deps.db;
    const office = await chicagoOffice();
    const election = await insertElection(db, {
      officeId: office.id,
      electionDate: '2027-06-01',
      fieldMeta: {
        election_date: {
          source_url: null,
          quote: null,
          confidence: 'low',
          checked_at: '2027-02-01T08:00:00.000Z',
          rule_citation: 'Fixture Code 1-1',
        },
      },
    });
    const checkedAt = new Date('2027-02-03T10:00:00.000Z');
    const trackProof = {
      opensOn: '2027-03-01',
      closesOn: '2027-04-01',
      sourceUrl: 'https://example.test/fixture-calendar',
      quote: 'Fixture calendar quote.',
      confidence: 'high',
      checkedAt,
      ruleCitation: null,
    } as const;
    await insertFilingTrack(db, { electionId: election.id, track: 'incumbent', ...trackProof });
    const feeEntry = {
      source_url: 'https://example.test/fixture-fee',
      quote: 'Fixture fee quote.',
      confidence: 'medium',
      checked_at: '2027-02-04T10:00:00.000Z',
    };
    await insertFilingTrack(db, {
      electionId: election.id,
      track: 'party_primary',
      ...trackProof,
      feeCents: 2500,
      fieldMeta: { fee_cents: feeEntry },
    });
    await insertFilingTrack(db, {
      electionId: election.id,
      track: 'nonpartisan',
      ...trackProof,
      feeCents: 1000,
    });
    await insertCandidacy(db, { electionId: election.id });
    const view = (await loadElectionViews(db, { ids: [election.id], now: NOW, ctx: ctx() })).get(
      election.id,
    );
    expect(ElectionViewSchema.parse(view)).toEqual(view);
    expect(view?.tracks.map((track) => track.track)).toEqual([
      'party_primary',
      'nonpartisan',
      'incumbent',
    ]);
    const ownProof = {
      sourceUrl: 'https://example.test/fixture-calendar',
      quote: 'Fixture calendar quote.',
      confidence: 'high',
      checkedAt: '2027-02-03T10:00:00.000Z',
      ruleCitation: null,
    };
    expect(view?.tracks[0]?.fieldMeta.feeCents).toEqual({
      sourceUrl: 'https://example.test/fixture-fee',
      quote: 'Fixture fee quote.',
      confidence: 'medium',
      checkedAt: '2027-02-04T10:00:00.000Z',
      ruleCitation: null,
    });
    expect(view?.tracks[1]?.fieldMeta).toEqual({
      opensOn: ownProof,
      closesOn: ownProof,
      feeCents: ownProof,
    });
    expect(view?.tracks[2]?.fieldMeta.feeCents).toBeUndefined();
    expect(view).toMatchObject({
      officeId: office.id,
      electionDateMeta: { confidence: 'low', ruleCitation: 'Fixture Code 1-1' },
      filingOpens: '2027-03-01',
      filingDeadline: { date: '2027-04-01', time: null, timezone: ZONE },
      filingStatus: 'open',
      deadlineConflict: null,
      candidatesCount: 1,
    });
    expect(view?.tracks[0]).toMatchObject({ timezone: ZONE, closesTime: null, feeCents: 2500 });
  });

  it('a deadline conflict is sent in camelCase', async () => {
    const db = testApp.deps.db;
    const office = await chicagoOffice();
    const election = await insertElection(db, {
      officeId: office.id,
      electionDate: '2027-06-01',
      deadlineConflict: [
        {
          track: 'nonpartisan',
          field: 'closes_on',
          computed: { value: '2027-04-01', rule_citation: 'Fixture Code 2-2' },
          scraped: {
            value: '2027-04-02',
            source_url: 'https://example.test/fixture-scraped',
            quote: 'Fixture scraped quote.',
            checked_at: '2027-02-05T10:00:00.000Z',
          },
        },
      ],
    });
    const view = (await loadElectionViews(db, { ids: [election.id], now: NOW, ctx: ctx() })).get(
      election.id,
    );
    expect(view?.deadlineConflict).toEqual([
      {
        track: 'nonpartisan',
        field: 'closes_on',
        computed: { value: '2027-04-01', ruleCitation: 'Fixture Code 2-2' },
        scraped: {
          value: '2027-04-02',
          sourceUrl: 'https://example.test/fixture-scraped',
          quote: 'Fixture scraped quote.',
          checkedAt: '2027-02-05T10:00:00.000Z',
        },
      },
    ]);
    expect(view?.filingStatus).toBe('dates_not_known');
  });
});

describe('loadResultViews', () => {
  it('turnout is a whole percent', async () => {
    const db = testApp.deps.db;
    const counted = await insertDistrict(db, { population18: 5000 });
    const empty = await insertDistrict(db, { population18: 0 });
    const first = await insertOffice(db, { districtId: counted.id });
    const second = await insertOffice(db, { districtId: empty.id });
    const known = await insertResult(db, {
      officeId: first.id,
      totalVotes: 1234,
      candidates: [{ name: 'Fixture Winner', party: null, votes: 700, winner: true }],
      checkedAt: new Date('2026-11-10T12:00:00.000Z'),
    });
    const unknown = await insertResult(db, { officeId: second.id, totalVotes: 1234 });
    const views = await loadResultViews(db, { ids: [known.id, unknown.id] });
    expect(ResultViewSchema.parse(views.get(known.id))).toEqual(views.get(known.id));
    expect(views.get(known.id)).toMatchObject({
      totalVotes: 1234,
      turnoutPct: 25,
      candidates: [{ name: 'Fixture Winner', party: null, votes: 700, winner: true }],
      checkedAt: '2026-11-10T12:00:00.000Z',
    });
    expect(views.get(unknown.id)?.turnoutPct).toBeNull();
  });
});

describe('loadCandidacyViews', () => {
  it('a candidacy carries its office and history; one whose person does not resolve is left out', async () => {
    const db = testApp.deps.db;
    const office = await chicagoOffice();
    const election = await insertElection(db, { officeId: office.id, electionDate: '2027-06-01' });
    const filed = await insertCandidacy(db, {
      electionId: election.id,
      statusHistory: [
        { status: 'filed', on: '2027-02-10', source_url: 'https://example.test/fixture-list' },
      ],
      filedOn: '2027-02-10',
    });
    const director = await insertPerson(db, { rosterOnly: true });
    const hidden = await insertCandidacy(db, { electionId: election.id, personId: director.id });
    const views = await loadCandidacyViews(db, {
      ids: [filed.id, hidden.id],
      viewerId: null,
      now: NOW,
      ctx: ctx(),
    });
    expect([...views.keys()]).toEqual([filed.id]);
    const view = views.get(filed.id);
    expect(CandidacyViewSchema.parse(view)).toEqual(view);
    expect(view).toMatchObject({
      person: { id: filed.personId },
      office: {
        id: office.id,
        slug: office.slug,
        jurisdictionName: 'Fixture City',
        retiredAt: null,
      },
      electionId: election.id,
      electionDate: '2027-06-01',
      electionKind: 'general',
      status: 'filed',
      statusHistory: [
        { status: 'filed', on: '2027-02-10', sourceUrl: 'https://example.test/fixture-list' },
      ],
      filedOn: '2027-02-10',
    });
  });
});

describe('statement counts', () => {
  it('fifty ids cost one statement per shape', async () => {
    const db = testApp.deps.db;
    const district = await insertDistrict(db);
    const officeIds: string[] = [];
    const personIds: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      officeIds.push((await insertOffice(db, { districtId: district.id })).id);
      personIds.push((await insertPerson(db)).id);
    }
    const viewer = await insertUser(db);

    testApp.resetStatementCount();
    const offices = await loadOfficeSummaries(db, {
      ids: officeIds,
      viewerId: viewer.id,
      now: NOW,
      ctx: ctx(),
    });
    expect(offices.size).toBe(50);
    expect(testApp.statementCount()).toBe(1);

    testApp.resetStatementCount();
    const persons = await loadPersonSummaries(db, {
      ids: personIds,
      viewerId: viewer.id,
      now: NOW,
      ctx: ctx(),
    });
    expect(persons.size).toBe(50);
    expect(testApp.statementCount()).toBe(2);

    testApp.resetStatementCount();
    await loadPersonSummaries(db, { ids: personIds, viewerId: null, now: NOW, ctx: ctx() });
    expect(testApp.statementCount()).toBe(1);

    testApp.resetStatementCount();
    expect(
      (await loadOfficeSummaries(db, { ids: [], viewerId: null, now: NOW, ctx: ctx() })).size,
    ).toBe(0);
    expect(testApp.statementCount()).toBe(0);
  });
});
