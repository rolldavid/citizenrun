import { issues, powers } from '@citizenrun/db';
import {
  insertDistrict,
  insertElection,
  insertFilingTrack,
  insertJurisdiction,
  insertOffice,
  insertOfficePower,
  insertOfficeholder,
  insertPerson,
  insertRateCounter,
  insertResult,
  insertUser,
  setOfficeIssues,
} from '@citizenrun/db/testing';
import {
  ERROR_CODES,
  ErrorEnvelopeSchema,
  OfficeDetailSchema,
  OfficeSummarySchema,
} from '@citizenrun/shared';
import type { ErrorCode, OfficeDetail } from '@citizenrun/shared';
import { asc, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { civicReadContextOf, loadOfficeSummaries } from '../../services/civic/loaders.ts';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-OFF-01: TEST-api-OFF for GET /v1/offices/:idOrSlug. Every civic row is a factory row of ZZ.
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const ZONE = 'America/Chicago';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// civic_read: 600 a minute per signed-in user.
const CIVIC_PER_MINUTE = 600;
const PROOF = {
  source_url: 'https://example.test/fixture-proof',
  quote: 'Fixture quote.',
  confidence: 'medium',
  checked_at: '2026-01-01T08:00:00.000Z',
} as const;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Early in a minute, so a burst of requests shares one window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

/** The UTC date `days` days after the clock, as YYYY-MM-DD; offsets of 2 days or more stay clear of the zone. */
function day(days: number): string {
  return new Date(testApp.deps.clock.now().getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

type Place = {
  jurisdiction?: Parameters<typeof insertJurisdiction>[1];
  district?: Parameters<typeof insertDistrict>[1];
};

/** An office of a Chicago-zoned fixture city. */
async function cityOffice(overrides: Parameters<typeof insertOffice>[1] = {}, place: Place = {}) {
  const { db } = testApp.deps;
  const jurisdiction = await insertJurisdiction(db, {
    kind: 'city',
    name: 'Fixture City',
    timezone: ZONE,
    ...place.jurisdiction,
  });
  const district = await insertDistrict(db, {
    jurisdictionId: jurisdiction.id,
    level: 'local',
    ...place.district,
  });
  return insertOffice(db, {
    jurisdictionId: jurisdiction.id,
    districtId: district.id,
    ...overrides,
  });
}

/** An election of the office on `electionDay` with one track opening and closing on the given days. */
async function electionWithTrack(
  officeId: string,
  input: {
    electionDay: number;
    opensDay?: number;
    closesDay: number;
    closesTime?: string | null;
    kind?: 'primary' | 'general' | 'special';
  },
) {
  const { db } = testApp.deps;
  const election = await insertElection(db, {
    officeId,
    kind: input.kind ?? 'general',
    electionDate: day(input.electionDay),
  });
  await insertFilingTrack(db, {
    electionId: election.id,
    opensOn: day(input.opensDay ?? input.closesDay - 30),
    closesOn: day(input.closesDay),
    closesTime: input.closesTime ?? null,
  });
  return election;
}

async function signedIn(): Promise<{ userId: string; auth: TestAuth }> {
  const user = await insertUser(testApp.deps.db);
  return { userId: user.id, auth: await signIn(testApp.deps.db, user, 'bearer') };
}

function get(idOrSlug: string, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.get(`/v1/offices/${idOrSlug}`, options);
}

async function detailOf(idOrSlug: string, options: TestRequestOptions = {}): Promise<OfficeDetail> {
  const response = await get(idOrSlug, options);
  expect(response.status).toBe(200);
  return OfficeDetailSchema.parse(await response.json());
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<string> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const text = await response.text();
  const body: unknown = JSON.parse(text);
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
  return text;
}

async function issueIds(): Promise<string[]> {
  const rows = await testApp.deps.db
    .select({ id: issues.id })
    .from(issues)
    .orderBy(asc(issues.sort));
  return rows.map((row) => row.id);
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error('The fixture list is too short.');
  }
  return value;
}

describe('GET /v1/offices/:idOrSlug', () => {
  it('ok', async () => {
    const office = await cityOffice();
    const response = await get(office.slug);
    expect(response.status).toBe(200);
    const detail = OfficeDetailSchema.parse(await response.json());
    expect(detail.id).toBe(office.id);
    expect(detail.officeTypeName.length).toBeGreaterThan(0);
  });

  it('rejects invalid input', async () => {
    const office = await cityOffice();
    const badIssue = await get(office.slug, { query: { issue: 'not-an-issue' } });
    const text = await expectEnvelope(badIssue, 'invalid_request');
    expect(JSON.parse(text)).toMatchObject({ error: { fields: { issue: 'invalid_value' } } });
    const long = await get('a'.repeat(201));
    const longText = await expectEnvelope(long, 'invalid_request');
    expect(JSON.parse(longText)).toMatchObject({ error: { fields: { idOrSlug: 'too_long' } } });
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await get('fixture-no-such-office'), 'not_found');
    await expectEnvelope(await get('a'.repeat(201)), 'invalid_request');
    await expectEnvelope(
      await get('fixture-no-such-office', { client: null }),
      'client_header_required',
    );
  });

  it('allows logged-out reads', async () => {
    const office = await cityOffice();
    const detail = await detailOf(office.slug);
    expect(detail.viewer).toEqual({
      following: false,
      bookmarked: false,
      running: false,
      declarationId: null,
    });
  });

  it('hides what the viewer may not see', async () => {
    const unknown = await expectEnvelope(await get('fixture-no-such-office'), 'not_found');
    const malformed = await expectEnvelope(
      await get(encodeURIComponent('Not A Slug!')),
      'not_found',
    );
    expect(unknown).toBe(malformed);
  });

  it('rate-limited', async () => {
    const office = await cityOffice();
    const { userId, auth } = await signedIn();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:civic:1m`,
      windowStart,
      count: CIVIC_PER_MINUTE,
    });
    const response = await get(office.slug, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });

  it("logged out uses the office's strongest issue", async () => {
    const office = await cityOffice();
    const ids = await issueIds();
    const strongest = at(ids, 4);
    const other = at(ids, 1);
    await setOfficeIssues(testApp.deps.db, office.id, [
      { issueId: other, relevance: 1 },
      { issueId: strongest, relevance: 3 },
    ]);
    const response = await get(office.slug);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    const detail = OfficeDetailSchema.parse(await response.json());
    expect(detail.impactMode).toBe('single_issue');
    expect(detail.impactIssueId).toBe(strongest);
    expect(detail.impact).toBeNull();
    expect(detail.viewer.following).toBe(false);
    expect(detail.viewer.bookmarked).toBe(false);

    const chosen = await detailOf(office.slug, { query: { issue: other } });
    expect(chosen.impactIssueId).toBe(other);
    expect(chosen.headlineIssueId).toBe(other);

    const { auth } = await signedIn();
    const signedInResponse = await get(office.slug, { auth });
    expect(signedInResponse.status).toBe(200);
    expect(signedInResponse.headers.get('cache-control')).toBe('no-store');
  });

  it('id and slug give the same body', async () => {
    const office = await cityOffice({ payAnnualCents: 1_200_000 });
    expect(await detailOf(office.id)).toEqual(await detailOf(office.slug));
  });

  it("an unknown slug and 'not a slug' answer 404", async () => {
    await expectEnvelope(await get('fixture-no-such-office'), 'not_found');
    await expectEnvelope(await get(encodeURIComponent('not a slug')), 'not_found');
    await expectEnvelope(await get('00000000-0000-7000-8000-00000000ffff'), 'not_found');
  });

  it('a 201-character path answers 400', async () => {
    await expectEnvelope(await get('a'.repeat(201)), 'invalid_request');
  });

  it('a retired office answers 200 with retiredAt', async () => {
    const retiredAt = new Date('2026-01-02T03:04:05.000Z');
    const office = await cityOffice({ retiredAt });
    expect((await detailOf(office.slug)).retiredAt).toBe(retiredAt.toISOString());
  });

  it('a placeholder answers 200 with every act-on field null', async () => {
    const office = await cityOffice({ placeholder: true });
    const detail = await detailOf(office.slug);
    expect(detail.placeholder).toBe(true);
    for (const key of [
      'payAnnualCents',
      'payAmountCents',
      'hoursPerWeek',
      'filingFeeCents',
      'signaturesRequired',
      'whereToFile',
      'filingDeadline',
      'nextElection',
      'nextElectionDetail',
    ] as const) {
      expect(detail[key], key).toBeNull();
    }
    expect(detail.fieldMeta).toEqual({});
    expect(detail.filingStatus).toBe('no_election');
  });

  it('every act-on field is a value with its proof or null with none', async () => {
    const office = await cityOffice({
      payAnnualCents: 1_500_000,
      payKind: 'salary',
      payAmountCents: 1_500_000,
      payPeriod: 'year',
      hoursPerWeek: '10',
      filingFeeCents: 5_000,
      signaturesRequired: 50,
      whereToFile: 'Fixture City Clerk',
      fieldMeta: {
        pay_annual_cents: PROOF,
        pay_kind: PROOF,
        pay_amount_cents: PROOF,
        pay_period: PROOF,
        hours_per_week: PROOF,
        filing_fee_cents: PROOF,
        signatures_required: PROOF,
        where_to_file: PROOF,
        seats: PROOF,
      },
    });
    await electionWithTrack(office.id, { electionDay: 120, closesDay: 40 });
    const detail = await detailOf(office.slug);
    const values: Record<string, unknown> = { ...detail };
    for (const [key, meta] of Object.entries(detail.fieldMeta)) {
      expect(values[key], key).not.toBeNull();
      expect(meta?.confidence, key).toBeDefined();
    }
    for (const key of [
      'payAnnualCents',
      'payKind',
      'payAmountCents',
      'payPeriod',
      'hoursPerWeek',
      'filingFeeCents',
      'signaturesRequired',
      'whereToFile',
      'seats',
      'filingDeadline',
    ]) {
      if (values[key] !== null) {
        expect(Object.keys(detail.fieldMeta), key).toContain(key);
      }
    }
    expect(detail.fieldMeta.filingDeadline).toBeDefined();

    // A stored proof for a value that is not known is never sent.
    const unknownFee = await cityOffice({
      filingFeeCents: null,
      fieldMeta: { filing_fee_cents: PROOF },
    });
    expect((await detailOf(unknownFee.slug)).fieldMeta).not.toHaveProperty('filingFeeCents');
  });

  it('the closing time is sent only when sourced', async () => {
    const untimed = await cityOffice();
    await electionWithTrack(untimed.id, { electionDay: 120, closesDay: 40 });
    expect((await detailOf(untimed.slug)).filingDeadline).toEqual({
      date: day(40),
      time: null,
      timezone: ZONE,
    });

    const noon = await cityOffice();
    await electionWithTrack(noon.id, { electionDay: 120, closesDay: 40, closesTime: '12:00' });
    expect((await detailOf(noon.slug)).filingDeadline).toEqual({
      date: day(40),
      time: '12:00',
      timezone: ZONE,
    });

    const two = await cityOffice();
    const election = await electionWithTrack(two.id, {
      electionDay: 120,
      closesDay: 40,
      closesTime: '17:00',
    });
    await insertFilingTrack(testApp.deps.db, {
      electionId: election.id,
      track: 'independent',
      opensOn: day(10),
      closesOn: day(40),
      closesTime: null,
    });
    expect((await detailOf(two.slug)).filingDeadline?.time).toBe('17:00');
  });

  it('the next fileable election is found without a stored id', async () => {
    const office = await cityOffice();
    await electionWithTrack(office.id, { electionDay: 20, opensDay: -40, closesDay: -3 });
    const future = await electionWithTrack(office.id, {
      electionDay: 120,
      opensDay: -5,
      closesDay: 40,
    });
    const detail = await detailOf(office.slug);
    expect(detail.nextElection?.id).toBe(future.id);
    expect(detail.nextElectionDetail?.id).toBe(future.id);
    expect(detail.filingDeadline?.date).toBe(day(40));
    expect(detail.filingStatus).toBe(detail.nextElectionDetail?.filingStatus);
    expect(detail.filingStatus).not.toBe('closed');
  });

  it('a runoff is never chosen', async () => {
    const office = await cityOffice();
    await electionWithTrack(office.id, {
      kind: 'primary',
      electionDay: 30,
      opensDay: -40,
      closesDay: -2,
    });
    await insertElection(testApp.deps.db, {
      officeId: office.id,
      kind: 'primary_runoff',
      electionDate: day(60),
    });
    const general = await electionWithTrack(office.id, {
      electionDay: 150,
      opensDay: -5,
      closesDay: 80,
    });
    const detail = await detailOf(office.slug);
    expect(detail.nextElection?.id).toBe(general.id);
    expect(detail.nextElectionDetail?.id).toBe(general.id);
    expect(detail.filingDeadline?.date).toBe(day(80));
  });

  it('a conflict carries both values', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(120),
      deadlineConflict: [
        {
          track: 'nonpartisan',
          field: 'closes_on',
          computed: { value: day(40), rule_citation: 'Fixture Code 1-2' },
          scraped: {
            value: day(41),
            source_url: 'https://example.test/fixture-calendar',
            quote: 'Fixture calendar quote.',
            checked_at: '2026-01-03T10:00:00.000Z',
          },
        },
      ],
    });
    await insertFilingTrack(testApp.deps.db, {
      electionId: election.id,
      opensOn: day(-5),
      closesOn: day(40),
    });
    const detail = await detailOf(office.slug);
    expect(detail.nextElectionDetail?.deadlineConflict).toEqual([
      {
        track: 'nonpartisan',
        field: 'closes_on',
        computed: { value: day(40), ruleCitation: 'Fixture Code 1-2' },
        scraped: {
          value: day(41),
          sourceUrl: 'https://example.test/fixture-calendar',
          quote: 'Fixture calendar quote.',
          checkedAt: '2026-01-03T10:00:00.000Z',
        },
      },
    ]);
  });

  it('board control', async () => {
    const board = await cityOffice({ seats: 3, bodySize: 7, seatsUpNext: 3, partisan: false });
    expect((await detailOf(board.slug)).boardControl).toEqual({
      seats: 3,
      bodySize: 7,
      seatsUpNext: 3,
      majority: 4,
      partySplit: null,
    });

    const partisan = await cityOffice({ seats: 4, bodySize: 7, seatsUpNext: 4, partisan: true });
    for (const party of ['democratic', 'democratic', 'republican', null]) {
      const person = await insertPerson(testApp.deps.db, { party });
      await insertOfficeholder(testApp.deps.db, { officeId: partisan.id, personId: person.id });
    }
    expect((await detailOf(partisan.slug)).boardControl?.partySplit).toEqual([
      { party: 'democratic', count: 2 },
      { party: 'republican', count: 1 },
      { party: null, count: 1 },
    ]);

    const single = await cityOffice();
    expect((await detailOf(single.slug)).boardControl).toBeNull();
  });

  it('term pay and hourly pay', async () => {
    const paid = await cityOffice({
      payAnnualCents: 5_294_100,
      termYears: '4',
      hoursPerWeek: '20',
    });
    const detail = await detailOf(paid.slug);
    expect(detail.termPayCents).toBe(21_176_400);
    expect(detail.effectiveHourlyCents).toBe(5_090);

    const perMeeting = await cityOffice({
      payKind: 'per_meeting',
      payAmountCents: 5_000,
      payPeriod: 'meeting',
      termYears: '4',
      hoursPerWeek: '5',
    });
    const meeting = await detailOf(perMeeting.slug);
    expect(meeting.termPayCents).toBeNull();
    expect(meeting.effectiveHourlyCents).toBeNull();
  });

  it('upcoming elections, results and holders are ordered and capped', async () => {
    const { db } = testApp.deps;
    const office = await cityOffice({}, { district: { population18: 10_000 } });
    await insertElection(db, { officeId: office.id, electionDate: day(-30) });
    const expected: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const general = await insertElection(db, {
        officeId: office.id,
        kind: 'general',
        electionDate: day(10 + index * 10),
      });
      const primary = await insertElection(db, {
        officeId: office.id,
        kind: 'primary',
        electionDate: day(10 + index * 10),
      });
      expected.push(primary.id, general.id);
    }
    const resultIds: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const result = await insertResult(db, {
        officeId: office.id,
        electionDate: day(-40 * (index + 1)),
        totalVotes: 100 * (index + 1),
      });
      resultIds.push(result.id);
    }
    const holderOld = await insertPerson(db, { name: 'Fixture Holder Old' });
    const holderUp = await insertPerson(db, { name: 'Fixture Holder Up' });
    const roster = await insertPerson(db, { name: 'Fixture Roster Director', rosterOnly: true });
    await insertOfficeholder(db, {
      officeId: office.id,
      personId: holderOld.id,
      seatUpNext: false,
      since: '2020-01-01',
    });
    await insertOfficeholder(db, {
      officeId: office.id,
      personId: roster.id,
      seatUpNext: null,
    });
    await insertOfficeholder(db, {
      officeId: office.id,
      personId: holderUp.id,
      seatUpNext: true,
      since: '2022-01-01',
    });

    const detail = await detailOf(office.slug);
    expect(detail.upcomingElections.map((election) => election.id)).toEqual(expected.slice(0, 10));
    expect(detail.results.map((result) => result.id)).toEqual(resultIds.slice(0, 10));
    expect(detail.results.map((result) => result.turnoutPct)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(detail.officeholders.map((holder) => holder.person.id)).toEqual([
      holderUp.id,
      holderOld.id,
      roster.id,
    ]);
    expect(detail.officeholders[2]?.person.rosterOnly).toBe(true);
  });

  it('powers list their issues', async () => {
    const { db } = testApp.deps;
    const office = await cityOffice();
    const linked = await db.execute<{ powerId: string }>(
      sql`select power_id as "powerId" from issue_powers group by power_id order by power_id limit 3`,
      'objects',
    );
    expect(linked).toHaveLength(3);
    const [strong, ...rest] = linked.map((row) => row.powerId);
    if (strong === undefined) {
      throw new Error('No power has an issue.');
    }
    await insertOfficePower(db, { officeId: office.id, powerId: strong, relevance: 3 });
    for (const powerId of rest) {
      await insertOfficePower(db, { officeId: office.id, powerId, relevance: 2 });
    }
    const byName = await db.execute<{ id: string }>(
      sql`select id from ${powers} where id = any(${sql.param(rest)}::text[]) order by name`,
      'objects',
    );
    const detail = await detailOf(office.slug);
    expect(detail.powers.map((power) => power.powerId)).toEqual([
      strong,
      ...byName.map((row) => row.id),
    ]);
    for (const power of detail.powers) {
      const expected = await db.execute<{ issueId: string }>(
        sql`select ip.issue_id as "issueId" from issue_powers ip
            join issues i on i.id = ip.issue_id
            where ip.power_id = ${power.powerId}
            order by i.sort`,
        'objects',
      );
      expect(power.issueIds).toEqual(expected.map((row) => row.issueId));
    }
  });

  it('a party seat filled by caucus has no election', async () => {
    const office = await cityOffice({
      officeTypeId: 'party-precinct-committee',
      partySelection: 'caucus',
      fieldMeta: { party_selection: PROOF },
    });
    const detail = await detailOf(office.slug);
    expect(detail.partySelection).toBe('caucus');
    expect(detail.filingStatus).toBe('no_election');
    expect(detail.fieldMeta.partySelection).toMatchObject({ confidence: 'medium' });
  });

  it('later keys have their empty forms', async () => {
    const office = await cityOffice();
    const detail = await detailOf(office.slug);
    expect(detail.headlineIssue).toBeNull();
    expect(detail.impactInputs).toEqual({
      issues: [],
      scale: null,
      pivot: null,
      termFactor: null,
      population: null,
      populationSource: null,
      label: null,
    });
    expect(detail.declaredRunners).toEqual([]);
    expect(detail.declaredRunnersCount).toBe(0);
    expect(detail.viewer.running).toBe(false);
    expect(detail.candidates).toEqual([]);
    expect(detail.candidatesCount).toBe(0);
  });

  it('the loader gives the same summary as the page', async () => {
    const office = await cityOffice({
      payAnnualCents: 2_400_000,
      hoursPerWeek: '15',
      fieldMeta: { pay_annual_cents: PROOF, hours_per_week: PROOF },
    });
    await electionWithTrack(office.id, { electionDay: 120, closesDay: 40 });
    const holder = await insertPerson(testApp.deps.db);
    await insertOfficeholder(testApp.deps.db, { officeId: office.id, personId: holder.id });
    const { userId, auth } = await signedIn();
    const detail = await detailOf(office.slug, { auth });
    const summaries = await loadOfficeSummaries(testApp.deps.db, {
      ids: [office.id],
      viewerId: userId,
      now: testApp.deps.clock.now(),
      ctx: civicReadContextOf(testApp.deps),
    });
    expect(OfficeSummarySchema.parse(detail)).toEqual(
      OfficeSummarySchema.parse(summaries.get(office.id)),
    );
  });
});
