import { people } from '@citizenrun/db';
import {
  insertCandidacy,
  insertElection,
  insertFollow,
  insertJurisdiction,
  insertOffice,
  insertOfficeholder,
  insertPerson,
  insertRateCounter,
  insertUser,
} from '@citizenrun/db/testing';
import {
  ERROR_CODES,
  ErrorEnvelopeSchema,
  PersonDetailSchema,
  PersonSummarySchema,
} from '@citizenrun/shared';
import type { ErrorCode, PersonDetail } from '@citizenrun/shared';
import { civicPhotoKey } from '@citizenrun/shared/storage';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { civicReadContextOf, loadPersonSummaries } from '../../services/civic/loaders.ts';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-PPL-01: TEST-api-PPL's cases for GET /v1/people/:idOrSlug, on factory rows of ZZ.
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// civic_read: 600 a minute per signed-in user.
const CIVIC_PER_MINUTE = 600;
const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Early in a minute, so a burst of requests shares one window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function get(idOrSlug: string, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.get(`/v1/people/${encodeURIComponent(idOrSlug)}`, options);
}

async function detailOf(idOrSlug: string, options: TestRequestOptions = {}): Promise<PersonDetail> {
  const response = await get(idOrSlug, options);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return PersonDetailSchema.parse(JSON.parse(text));
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body: unknown = await response.json();
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
}

async function viewerAuth(): Promise<{ userId: string; auth: TestAuth }> {
  const user = await insertUser(testApp.deps.db);
  return { userId: user.id, auth: await signIn(testApp.deps.db, user, 'bearer') };
}

/** A person holding a new office of ZZ since 2021. */
async function holder(overrides: Parameters<typeof insertPerson>[1] = {}) {
  const person = await insertPerson(testApp.deps.db, overrides);
  const office = await insertOffice(testApp.deps.db);
  await insertOfficeholder(testApp.deps.db, {
    personId: person.id,
    officeId: office.id,
    since: '2021-01-04',
  });
  return { person, office };
}

describe('GET /v1/people/:idOrSlug', () => {
  it('ok', async () => {
    const { person, office } = await holder({ party: 'democratic' });
    const detail = await detailOf(person.slug);
    expect(detail).toMatchObject({
      id: person.id,
      slug: person.slug,
      name: person.name,
      party: 'democratic',
      claimed: false,
      rosterOnly: false,
      retiredAt: null,
      followerCount: 0,
      candidacies: [],
    });
    expect(detail.seats).toEqual([
      {
        office: {
          id: office.id,
          slug: office.slug,
          title: office.title,
          state: 'ZZ',
          jurisdictionName: expect.any(String),
          retiredAt: null,
        },
        seatLabel: null,
        since: '2021-01-04',
        until: null,
        current: true,
      },
    ]);
  });

  it('rejects invalid input', async () => {
    await expectEnvelope(await get('a'.repeat(201)), 'invalid_request');
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await get('a'.repeat(201)), 'invalid_request');
    await expectEnvelope(await get(UNKNOWN_ID), 'not_found');
    await expectEnvelope(await get('Not A Slug'), 'not_found');
  });

  it('allows logged-out reads', async () => {
    const { person } = await holder();
    const response = await get(person.slug);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('logged out answers 200 with no viewer flag', async () => {
    const { person } = await holder();
    const { userId, auth } = await viewerAuth();
    await insertFollow(testApp.deps.db, {
      followerId: userId,
      targetType: 'person',
      targetId: person.id,
    });
    const response = await get(person.slug);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    const loggedOut = PersonDetailSchema.parse(await response.json());
    expect(loggedOut.viewer).toEqual({
      following: false,
      isOwner: false,
      claimStatus: null,
      photoPending: false,
      pendingClaim: null,
    });
    const signedIn = await get(person.slug, { auth });
    expect(signedIn.headers.get('cache-control')).toBe('no-store');
    const own = PersonDetailSchema.parse(await signedIn.json());
    expect(own.viewer.following).toBe(true);
    expect(own.followerCount).toBe(1);
  });

  it('hides what the viewer may not see', async () => {
    const unknownText = await (await get(UNKNOWN_ID)).text();
    const director = await insertPerson(testApp.deps.db, { rosterOnly: true });
    const roster = await get(director.id);
    expect(roster.status).toBe(404);
    expect(await roster.text()).toBe(unknownText);
  });

  it('rate-limited', async () => {
    const { person } = await holder();
    const { userId, auth } = await viewerAuth();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:civic:1m`,
      windowStart,
      count: CIVIC_PER_MINUTE,
    });
    const response = await get(person.slug, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });

  it('by id and by slug give the same body', async () => {
    const { person } = await holder();
    const byId = await (await get(person.id)).text();
    const bySlug = await (await get(person.slug)).text();
    expect(byId).toBe(bySlug);
    expect(JSON.parse(byId)).toMatchObject({ id: person.id });
  });

  it('a merged person resolves to the survivor', async () => {
    const { person: survivor } = await holder();
    const merged = await insertPerson(testApp.deps.db, { mergedInto: survivor.id });
    const detail = await detailOf(merged.slug);
    expect(detail.id).toBe(survivor.id);
    expect(detail.slug).toBe(survivor.slug);
    expect(detail).toEqual(await detailOf(survivor.slug));
  });

  it('a chain of six merges answers 404', async () => {
    const survivor = await insertPerson(testApp.deps.db);
    let next = survivor.id;
    const chain: string[] = [];
    for (let n = 0; n < 6; n += 1) {
      next = (await insertPerson(testApp.deps.db, { mergedInto: next })).id;
      chain.push(next);
    }
    await expectEnvelope(await get(next), 'not_found');
    // Five hops still resolve.
    expect((await detailOf(chain[4] ?? '')).id).toBe(survivor.id);
  });

  it('a merge cycle answers 404', async () => {
    const a = await insertPerson(testApp.deps.db);
    const b = await insertPerson(testApp.deps.db, { mergedInto: a.id });
    await testApp.deps.db.update(people).set({ mergedInto: b.id }).where(eq(people.id, a.id));
    await expectEnvelope(await get(a.slug), 'not_found');
    await expectEnvelope(await get(b.id), 'not_found');
  });

  it('a roster-only director answers 404', async () => {
    const director = await insertPerson(testApp.deps.db, { rosterOnly: true });
    const office = await insertOffice(testApp.deps.db);
    await insertOfficeholder(testApp.deps.db, { personId: director.id, officeId: office.id });
    await expectEnvelope(await get(director.slug), 'not_found');
    await expectEnvelope(await get(director.id), 'not_found');
  });

  it('a retired person answers 200 with retiredAt', async () => {
    const { person } = await holder({ retiredAt: new Date('2026-06-01T12:00:00.000Z') });
    expect((await detailOf(person.slug)).retiredAt).toBe('2026-06-01T12:00:00.000Z');
  });

  it('seats list the current one first, then by end date', async () => {
    const { db } = testApp.deps;
    const person = await insertPerson(db);
    const jurisdiction = await insertJurisdiction(db, { name: 'Fixture Seat County' });
    const oldest = await insertOffice(db, { jurisdictionId: jurisdiction.id });
    const recent = await insertOffice(db, {
      jurisdictionId: jurisdiction.id,
      retiredAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const current = await insertOffice(db, { jurisdictionId: jurisdiction.id });
    await insertOfficeholder(db, {
      personId: person.id,
      officeId: oldest.id,
      since: '2012-01-02',
      until: '2016-01-04',
    });
    await insertOfficeholder(db, {
      personId: person.id,
      officeId: current.id,
      since: '2024-01-08',
      seatLabel: 'Seat 3',
    });
    await insertOfficeholder(db, {
      personId: person.id,
      officeId: recent.id,
      since: '2016-01-04',
      until: '2024-01-08',
    });
    const detail = await detailOf(person.id);
    expect(detail.seats.map((seat) => seat.office.id)).toEqual([current.id, recent.id, oldest.id]);
    expect(detail.seats.map((seat) => seat.current)).toEqual([true, false, false]);
    expect(detail.seats[0]).toMatchObject({
      seatLabel: 'Seat 3',
      since: '2024-01-08',
      until: null,
    });
    expect(detail.seats[1]?.office).toEqual({
      id: recent.id,
      slug: recent.slug,
      title: recent.title,
      state: 'ZZ',
      jurisdictionName: 'Fixture Seat County',
      retiredAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('candidacies are newest first with their history', async () => {
    const { db } = testApp.deps;
    const person = await insertPerson(db);
    const office = await insertOffice(db);
    const older = await insertElection(db, { officeId: office.id, electionDate: '2025-11-04' });
    const newer = await insertElection(db, { officeId: office.id, electionDate: '2027-11-02' });
    const past = await insertCandidacy(db, {
      personId: person.id,
      electionId: older.id,
      status: 'lost',
    });
    const history = [
      { status: 'committee_registered', on: '2027-01-05', source_url: null },
      { status: 'qualified', on: '2027-03-01', source_url: 'https://example.test/fixture-list' },
    ];
    const next = await insertCandidacy(db, {
      personId: person.id,
      electionId: newer.id,
      status: 'qualified',
      statusHistory: history,
    });
    const detail = await detailOf(person.slug);
    expect(detail.candidacies.map((candidacy) => candidacy.id)).toEqual([next.id, past.id]);
    expect(detail.candidacies[0]?.statusHistory).toEqual([
      { status: 'committee_registered', on: '2027-01-05', sourceUrl: null },
      { status: 'qualified', on: '2027-03-01', sourceUrl: 'https://example.test/fixture-list' },
    ]);
    expect(detail.candidacies[0]).toMatchObject({
      electionDate: '2027-11-02',
      office: { id: office.id },
      person: { id: person.id },
    });
  });

  it('one follower of the person and of its claimed user counts once', async () => {
    const { db } = testApp.deps;
    const owner = await insertUser(db);
    const { person } = await holder({ claimedBy: owner.id });
    const both = await insertUser(db);
    const one = await insertUser(db);
    await insertFollow(db, { followerId: both.id, targetType: 'person', targetId: person.id });
    await insertFollow(db, { followerId: both.id, targetType: 'user', targetId: owner.id });
    await insertFollow(db, { followerId: one.id, targetType: 'user', targetId: owner.id });
    const detail = await detailOf(person.slug);
    expect(detail.followerCount).toBe(2);
    expect(detail.claimed).toBe(true);
    // The owner's account arrives with claims; until then it is not sent.
    expect(detail.claimedBy).toBeNull();
    const auth = await signIn(db, one, 'bearer');
    expect((await detailOf(person.slug, { auth })).viewer.following).toBe(true);
  });

  it('the photo has no blurhash and the stored size', async () => {
    const { person } = await holder({
      photoKey: civicPhotoKey('c'.repeat(64)),
      photoWidth: 320,
      photoHeight: 400,
      photoCredit: 'Fixture Credit',
      photoLicense: 'CC-BY-4.0',
      photoSourceUrl: 'https://example.test/fixture-photo',
    });
    const detail = await detailOf(person.slug);
    expect(detail.photo).toMatchObject({
      kind: 'image',
      key: civicPhotoKey('c'.repeat(64)),
      width: 320,
      height: 400,
      blurhash: null,
    });
    expect(detail.photoLicense).toBe('CC-BY-4.0');
    expect(detail.photoSourceUrl).toBe('https://example.test/fixture-photo');
  });

  it('the photo credit is sent', async () => {
    const { person } = await holder({
      photoKey: civicPhotoKey('d'.repeat(64)),
      photoWidth: 200,
      photoHeight: 200,
      photoCredit: 'Fixture Credit',
    });
    expect((await detailOf(person.slug)).photoCredit).toBe('Fixture Credit');
    const { person: bare } = await holder();
    const detail = await detailOf(bare.slug);
    expect(detail.photo).toBeNull();
    expect(detail.photoCredit).toBeNull();
  });

  it('claim and tool keys have their empty forms', async () => {
    const owner = await insertUser(testApp.deps.db);
    const { person } = await holder({
      claimedBy: owner.id,
      website: 'https://example.test/fixture-site',
      donateUrl: 'https://example.test/fixture-donate',
      volunteerUrl: 'https://example.test/fixture-volunteer',
      origin: { created_by: 'filing' },
    });
    const auth = await signIn(testApp.deps.db, owner, 'bearer');
    for (const options of [{}, { auth }]) {
      const detail = await detailOf(person.slug, options);
      expect(detail).toMatchObject({
        photoSource: null,
        origin: 'filing',
        website: 'https://example.test/fixture-site',
        donateUrl: null,
        volunteerUrl: null,
        pendingLinks: null,
        claimedBy: null,
        tools: { claims: false, links: false, help: false },
        help: null,
        viewer: { isOwner: false, claimStatus: null, photoPending: false, pendingClaim: null },
      });
    }
  });

  it('the loader gives the same summary as the page', async () => {
    const { person } = await holder({
      photoKey: civicPhotoKey('e'.repeat(64)),
      photoWidth: 100,
      photoHeight: 120,
    });
    const { userId, auth } = await viewerAuth();
    await insertFollow(testApp.deps.db, {
      followerId: userId,
      targetType: 'person',
      targetId: person.id,
    });
    const detail = await detailOf(person.slug, { auth });
    const loaded = await loadPersonSummaries(testApp.deps.db, {
      ids: [person.id],
      viewerId: userId,
      now: testApp.deps.clock.now(),
      ctx: civicReadContextOf(testApp.deps),
    });
    const summaryKeys = Object.keys(PersonSummarySchema.shape);
    const fromPage = Object.fromEntries(
      summaryKeys.map((key) => [
        key,
        key === 'viewer'
          ? { following: detail.viewer.following }
          : detail[key as keyof PersonDetail],
      ]),
    );
    expect(loaded.get(person.id)).toEqual(fromPage);
    expect(fromPage['viewer']).toEqual({ following: true });
  });
});
