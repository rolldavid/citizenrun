import {
  insertCandidacy,
  insertDistrict,
  insertElection,
  insertJurisdiction,
  insertOffice,
  insertPerson,
  insertRateCounter,
  insertUser,
} from '@citizenrun/db/testing';
import { CandidacyViewPageSchema, ERROR_CODES, ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { CandidacyStatus, CandidacyViewPage, ErrorCode } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-OFF-02: TEST-api-OFF for GET /v1/offices/:id/candidates.
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CIVIC_PER_MINUTE = 600;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function day(days: number): string {
  return new Date(testApp.deps.clock.now().getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

async function cityOffice() {
  const { db } = testApp.deps;
  const jurisdiction = await insertJurisdiction(db, { kind: 'city', timezone: 'America/Chicago' });
  const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id, level: 'local' });
  return insertOffice(db, { jurisdictionId: jurisdiction.id, districtId: district.id });
}

/** A candidacy of `name` in the election with the given status. */
async function candidacy(
  electionId: string,
  name: string,
  status: CandidacyStatus = 'filed',
  person: Parameters<typeof insertPerson>[1] = {},
) {
  const row = await insertPerson(testApp.deps.db, { name, lastName: name, ...person });
  return insertCandidacy(testApp.deps.db, { electionId, personId: row.id, status });
}

function list(officeId: string, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.get(`/v1/offices/${officeId}/candidates`, options);
}

async function pageOf(
  officeId: string,
  options: TestRequestOptions = {},
): Promise<CandidacyViewPage> {
  const response = await list(officeId, options);
  expect(response.status).toBe(200);
  return CandidacyViewPageSchema.parse(await response.json());
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body: unknown = await response.json();
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
}

async function viewerAuth() {
  const user = await insertUser(testApp.deps.db);
  return { userId: user.id, auth: await signIn(testApp.deps.db, user, 'bearer') };
}

describe('GET /v1/offices/:id/candidates', () => {
  it('ok', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(60),
    });
    const row = await candidacy(election.id, 'Fixture Alpha');
    const page = await pageOf(office.id);
    expect(page.items.map((item) => item.id)).toEqual([row.id]);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects invalid input', async () => {
    const office = await cityOffice();
    await expectEnvelope(await list('not-a-uuid'), 'invalid_request');
    for (const limit of ['0', '51', 'many']) {
      await expectEnvelope(await list(office.id, { query: { limit } }), 'invalid_request');
    }
    await expectEnvelope(
      await list(office.id, { query: { electionId: 'not-a-uuid' } }),
      'invalid_request',
    );
  });

  it('envelope on every error', async () => {
    const office = await cityOffice();
    await expectEnvelope(await list('not-a-uuid'), 'invalid_request');
    await expectEnvelope(await list(office.id, { query: { cursor: 'x' } }), 'invalid_cursor');
    await expectEnvelope(await list('00000000-0000-7000-8000-00000000ffff'), 'not_found');
  });

  it('allows logged-out reads', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(60),
    });
    await candidacy(election.id, 'Fixture Alpha');
    const response = await list(office.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    const page = CandidacyViewPageSchema.parse(await response.json());
    expect(page.items[0]?.person.viewer.following).toBe(false);
    const { auth } = await viewerAuth();
    expect((await list(office.id, { auth })).headers.get('cache-control')).toBe('no-store');
  });

  it('hides what the viewer may not see', async () => {
    const unknown = await list('00000000-0000-7000-8000-00000000ffff');
    const unknownText = await unknown.text();
    const office = await cityOffice();
    const otherOffice = await cityOffice();
    const otherElection = await insertElection(testApp.deps.db, {
      officeId: otherOffice.id,
      electionDate: day(60),
    });
    const foreign = await list(office.id, { query: { electionId: otherElection.id } });
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(unknownText);
  });

  it('rate-limited', async () => {
    const office = await cityOffice();
    const { userId, auth } = await viewerAuth();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:civic:1m`,
      windowStart,
      count: CIVIC_PER_MINUTE,
    });
    const response = await list(office.id, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });

  it('order across two elections and mixed statuses', async () => {
    const office = await cityOffice();
    const first = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(30),
    });
    const second = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(90),
    });
    const withdrawn = await candidacy(second.id, 'Fixture Aaron', 'withdrawn');
    const committee = await candidacy(first.id, 'Fixture Abel', 'committee_registered');
    const filedB = await candidacy(first.id, 'Fixture Beth', 'filed');
    const filedA = await candidacy(first.id, 'Fixture Anna', 'filed');
    const ballot = await candidacy(first.id, 'Fixture Zed', 'on_ballot');
    const page = await pageOf(office.id);
    expect(page.items.map((item) => item.id)).toEqual([
      ballot.id,
      filedA.id,
      filedB.id,
      committee.id,
      withdrawn.id,
    ]);
  });

  it('pages with cursors', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(60),
    });
    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      ids.push(
        (await candidacy(election.id, `Fixture Person ${String(index).padStart(2, '0')}`)).id,
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const query: Record<string, string> = { limit: '10' };
      if (cursor !== null) {
        query['cursor'] = cursor;
      }
      const page: CandidacyViewPage = await pageOf(office.id, { query });
      sizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(sizes).toEqual([10, 10, 5]);
    expect(seen).toEqual(ids);
  });

  it('paging returns each candidacy once', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(60),
    });
    const ids = new Set<string>();
    for (let index = 0; index < 25; index += 1) {
      ids.add((await candidacy(election.id, 'Fixture Same Name')).id);
    }
    const first = await pageOf(office.id, { query: { limit: '10' } });
    const second = await pageOf(office.id, {
      query: { limit: '10', cursor: first.nextCursor ?? '' },
    });
    const third = await pageOf(office.id, {
      query: { limit: '10', cursor: second.nextCursor ?? '' },
    });
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(all).toHaveLength(25);
    expect(new Set(all)).toEqual(ids);
  });

  it('a past election is excluded without electionId and included with it', async () => {
    const office = await cityOffice();
    const past = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(-30),
    });
    const row = await candidacy(past.id, 'Fixture Past');
    expect((await pageOf(office.id)).items).toEqual([]);
    const page = await pageOf(office.id, { query: { electionId: past.id } });
    expect(page.items.map((item) => item.id)).toEqual([row.id]);
  });

  it("another office's election id answers 404", async () => {
    const office = await cityOffice();
    const other = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: other.id,
      electionDate: day(60),
    });
    await expectEnvelope(
      await list(office.id, { query: { electionId: election.id } }),
      'not_found',
    );
  });

  it('committee_registered keeps its status', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(60),
    });
    await candidacy(election.id, 'Fixture Committee', 'committee_registered');
    expect((await pageOf(office.id)).items[0]?.status).toBe('committee_registered');
  });

  it('a roster-only person never appears', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(60),
    });
    await candidacy(election.id, 'Fixture Roster', 'filed', { rosterOnly: true });
    const shown = await candidacy(election.id, 'Fixture Shown');
    expect((await pageOf(office.id)).items.map((item) => item.id)).toEqual([shown.id]);
  });

  it('a tampered cursor answers 400 invalid_cursor', async () => {
    const office = await cityOffice();
    const election = await insertElection(testApp.deps.db, {
      officeId: office.id,
      electionDate: day(60),
    });
    for (let index = 0; index < 3; index += 1) {
      await candidacy(election.id, `Fixture Tamper ${String(index)}`);
    }
    const first = await pageOf(office.id, { query: { limit: '1' } });
    const cursor = first.nextCursor ?? '';
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const tampered = Buffer.from(JSON.stringify({ ...(decoded as object), i: 'x' })).toString(
      'base64url',
    );
    await expectEnvelope(await list(office.id, { query: { cursor: tampered } }), 'invalid_cursor');
    await expectEnvelope(
      await list(office.id, { query: { cursor: `${cursor}!` } }),
      'invalid_cursor',
    );
  });

  it('an empty office answers []', async () => {
    const office = await cityOffice();
    expect(await pageOf(office.id)).toEqual({ items: [], nextCursor: null });
  });

  it('no query per item', async () => {
    const { auth } = await viewerAuth();
    const one = await cityOffice();
    const many = await cityOffice();
    const oneElection = await insertElection(testApp.deps.db, {
      officeId: one.id,
      electionDate: day(60),
    });
    const manyElection = await insertElection(testApp.deps.db, {
      officeId: many.id,
      electionDate: day(60),
    });
    await candidacy(oneElection.id, 'Fixture Only');
    for (let index = 0; index < 20; index += 1) {
      await candidacy(manyElection.id, `Fixture Many ${String(index)}`);
    }
    expect((await pageOf(one.id, { auth })).items).toHaveLength(1);
    const forOne = testApp.statementCount();
    expect((await pageOf(many.id, { auth })).items).toHaveLength(20);
    expect(testApp.statementCount()).toBe(forOne);
  });
});
