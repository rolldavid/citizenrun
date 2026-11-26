import { appEvents, issues, userConsents, users } from '@citizenrun/db';
import { LocationResultSchema } from '@citizenrun/shared';
import { insertUser } from '@citizenrun/db/testing';
import { LEGAL_VERSIONS, MeSchema } from '@citizenrun/shared';
import type { Me } from '@citizenrun/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import {
  DEFAULT_FIXTURE_POINT,
  insertLocationFixture,
  locationBody,
} from '../../testing/location.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';
import { ONBOARDING_ORDER, advanceOnboarding, nextOnboardingStep } from './onboarding.ts';

// TEST-onboarding (L-onboarding, L-app-events).
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

let testApp: TestApp;
let issueIds: string[];

let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

beforeEach(async () => {
  testApp = await createTestApp();
  // Five minutes into an hour, so no case crosses an hour window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + 5 * MINUTE_MS));
  const rows = await testApp.deps.db
    .select({ id: issues.id })
    .from(issues)
    .orderBy(asc(issues.sort));
  issueIds = rows.map((row) => row.id);
});

function picks(count: number, starred = 0) {
  return issueIds.slice(0, count).map((issueId, index) => ({ issueId, starred: index < starred }));
}

async function expectMe(response: TestResponse): Promise<Me> {
  expect(response.status).toBe(200);
  return MeSchema.parse(await response.json());
}

async function newSignUp() {
  const user = await insertUser(testApp.deps.db, {
    handle: null,
    onboardingStep: 'photo',
    onboardedAt: null,
  });
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function eventsOf(userId: string) {
  return testApp.deps.db
    .select({ name: appEvents.name, props: appEvents.props, platform: appEvents.platform })
    .from(appEvents)
    .where(eq(appEvents.userId, userId))
    .orderBy(appEvents.id);
}

async function userRow(id: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, id));
  if (row === undefined) {
    throw new Error('The user row is gone.');
  }
  return row;
}

function skip(step: string, auth: TestAuth, options: TestRequestOptions = {}) {
  return testApp.request.post('/v1/me/onboarding/skip', { auth, body: { step }, ...options });
}

describe('L-onboarding', () => {
  it('the step after each step', () => {
    expect(ONBOARDING_ORDER).toEqual(['photo', 'handle', 'issues', 'location', 'done']);
    expect(nextOnboardingStep('photo')).toBe('handle');
    expect(nextOnboardingStep('handle')).toBe('issues');
    expect(nextOnboardingStep('issues')).toBe('location');
    expect(nextOnboardingStep('location')).toBe('done');
    expect(nextOnboardingStep('done')).toBe('done');
  });

  it('resumes on any device', async () => {
    const user = await insertUser(testApp.deps.db, {
      handle: null,
      onboardingStep: 'handle',
      onboardedAt: null,
    });
    const phone = await signIn(testApp.deps.db, user, 'bearer');
    const web = await signIn(testApp.deps.db, user, 'cookie');
    await expectMe(
      await testApp.request.put('/v1/me/handle', {
        auth: phone,
        body: { handle: 'fixture_resume' },
      }),
    );
    const me = await expectMe(await testApp.request.get('/v1/me', { auth: web }));
    expect(me.onboardingStep).toBe('issues');
    expect(me.session.platform).toBe('web');
  });

  it('photo is optional', async () => {
    const { auth } = await newSignUp();
    expect((await expectMe(await skip('photo', auth))).onboardingStep).toBe('handle');
  });

  it('issues need 3 to 10, up to 3 starred', async () => {
    const user = await insertUser(testApp.deps.db, { onboardingStep: 'issues', onboardedAt: null });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const put = (body: unknown) => testApp.request.put('/v1/me/issues', { auth, body });
    expect((await put({ issues: picks(2) })).status).toBe(400);
    expect((await put({ issues: picks(11) })).status).toBe(400);
    expect((await put({ issues: picks(5, 4) })).status).toBe(400);
    expect((await userRow(user.id)).onboardingStep).toBe('issues');
    expect((await expectMe(await put({ issues: picks(3, 3) }))).issues).toEqual(picks(3, 3));
    expect((await expectMe(await put({ issues: picks(10, 3) }))).issues).toEqual(picks(10, 3));
  });

  it('consents need an explicit agree', async () => {
    const signUp = async (email: string, signup: Record<string, unknown> | null) => {
      const started = await testApp.request.post('/v1/auth/email/start', {
        ip: freshIp(),
        body: { email },
      });
      expect(started.status).toBe(200);
      const { pendingToken } = await started.json<{ pendingToken: string }>();
      const code = testApp.fakes.mailer.codeFor(email);
      if (code === null) {
        throw new Error('No code was sent.');
      }
      return testApp.request.post('/v1/auth/email/verify', {
        ip: freshIp(),
        body: signup === null ? { pendingToken, code } : { pendingToken, code, signup },
      });
    };
    const signup = (aiScreening: boolean | null) => ({
      age: { method: 'self_declared', sourceTier: 'self' },
      agreements: {
        termsVersion: LEGAL_VERSIONS.terms,
        contentPolicyVersion: LEGAL_VERSIONS.content_policy,
        privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
      },
      aiScreening,
    });
    const consentsOf = async (email: string) => {
      const [user] = await testApp.deps.db.select().from(users).where(eq(users.email, email));
      if (user === undefined) {
        return null;
      }
      const rows = await testApp.deps.db
        .select({
          kind: userConsents.kind,
          version: userConsents.version,
          granted: userConsents.granted,
        })
        .from(userConsents)
        .where(eq(userConsents.userId, user.id));
      return rows.sort((a, b) => a.kind.localeCompare(b.kind));
    };

    const granted = await signUp('agree-with-ai@example.test', signup(true));
    expect(granted.status).toBe(200);
    expect(await consentsOf('agree-with-ai@example.test')).toEqual([
      { kind: 'ai_screening', version: LEGAL_VERSIONS.ai_screening, granted: true },
      { kind: 'content_policy', version: LEGAL_VERSIONS.content_policy, granted: true },
      { kind: 'privacy_policy', version: LEGAL_VERSIONS.privacy_policy, granted: true },
      { kind: 'terms', version: LEGAL_VERSIONS.terms, granted: true },
    ]);

    const unanswered = await signUp('agree-no-ai@example.test', signup(null));
    expect(unanswered.status).toBe(200);
    expect(await consentsOf('agree-no-ai@example.test')).toEqual([
      { kind: 'content_policy', version: LEGAL_VERSIONS.content_policy, granted: true },
      { kind: 'privacy_policy', version: LEGAL_VERSIONS.privacy_policy, granted: true },
      { kind: 'terms', version: LEGAL_VERSIONS.terms, granted: true },
    ]);

    const silent = await signUp('no-agree@example.test', null);
    expect(silent.status).toBe(422);
    expect(await consentsOf('no-agree@example.test')).toBeNull();
  });

  it('location step can be skipped', async () => {
    const user = await insertUser(testApp.deps.db, {
      onboardingStep: 'location',
      onboardedAt: null,
    });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const me = await expectMe(await skip('location', auth));
    expect(me.onboardingStep).toBe('done');
  });

  it('records the time to finish', async () => {
    const user = await insertUser(testApp.deps.db, {
      onboardingStep: 'location',
      onboardedAt: null,
    });
    const at = new Date(testApp.deps.clock.now().getTime() + 42_000);
    const moved = await testApp.deps.db.transaction((tx) =>
      advanceOnboarding(tx, {
        userId: user.id,
        from: 'location',
        outcome: 'skipped',
        platform: 'android',
        now: at,
      }),
    );
    expect(moved).toBe(true);
    const row = await userRow(user.id);
    expect(row.onboardingStep).toBe('done');
    expect(row.onboardedAt).toEqual(at);

    // Through the route, onboarded_at is the clock's now.
    const other = await insertUser(testApp.deps.db, {
      onboardingStep: 'location',
      onboardedAt: null,
    });
    await expectMe(await skip('location', await signIn(testApp.deps.db, other, 'bearer')));
    expect((await userRow(other.id)).onboardedAt).toEqual(testApp.deps.clock.now());
  });

  it('a step that is not current moves nothing and writes nothing', async () => {
    const user = await insertUser(testApp.deps.db, { onboardingStep: 'issues', onboardedAt: null });
    const moved = await testApp.deps.db.transaction((tx) =>
      advanceOnboarding(tx, {
        userId: user.id,
        from: 'photo',
        outcome: 'completed',
        platform: 'ios',
        now: testApp.deps.clock.now(),
      }),
    );
    expect(moved).toBe(false);
    expect((await userRow(user.id)).onboardingStep).toBe('issues');
    expect(await eventsOf(user.id)).toEqual([]);
  });

  it('each step change writes one onboarding_step event', async () => {
    const { user, auth } = await newSignUp();
    const android = { client: 'android/1.4.0' };
    await expectMe(await skip('photo', auth, android));
    await expectMe(
      await testApp.request.put('/v1/me/handle', {
        auth,
        body: { handle: 'fixture_steps' },
        ...android,
      }),
    );
    await expectMe(
      await testApp.request.put('/v1/me/issues', { auth, body: { issues: picks(3) }, ...android }),
    );
    await expectMe(await skip('location', auth, android));
    // A repeat of a passed step writes nothing more.
    await expectMe(await skip('photo', auth, android));
    // The session is an iOS one: the platform comes from X-OS-Client.
    expect(await eventsOf(user.id)).toEqual([
      {
        name: 'onboarding_step',
        props: { step: 'photo', outcome: 'skipped' },
        platform: 'android',
      },
      {
        name: 'onboarding_step',
        props: { step: 'handle', outcome: 'completed' },
        platform: 'android',
      },
      {
        name: 'onboarding_step',
        props: { step: 'issues', outcome: 'completed' },
        platform: 'android',
      },
      {
        name: 'onboarding_step',
        props: { step: 'location', outcome: 'skipped' },
        platform: 'android',
      },
      { name: 'onboarding_done', props: {}, platform: 'android' },
    ]);
  });
});

describe('L-onboarding location step', () => {
  it('the location step stores district ids only and counts what it stored', async () => {
    await insertLocationFixture(testApp.deps.db, testApp.deps.clock.now());
    const user = await insertUser(testApp.deps.db, {
      onboardingStep: 'location',
      onboardedAt: null,
    });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await testApp.request.put('/v1/me/location', {
      auth,
      body: locationBody(DEFAULT_FIXTURE_POINT.lat, DEFAULT_FIXTURE_POINT.lng),
    });
    expect(response.status).toBe(200);
    const result = LocationResultSchema.parse(await response.json());
    expect(result.me.onboardingStep).toBe('done');

    const exact = await testApp.deps.db.execute<{ id: string }>(
      sql`select d.id from user_districts ud join districts d on d.id = ud.district_id
          where ud.user_id = ${user.id} and d.geometry_quality = 'exact'`,
      'objects',
    );
    expect(result.exactDistrictCount).toBe(exact.length);
    expect(exact.length).toBeGreaterThan(0);
    const offices = await testApp.deps.db.execute<{ n: number }>(
      sql`select count(*)::int as n from offices
          where district_id = any(${sql.param(exact.map((row) => row.id))}::uuid[])
            and retired_at is null and not placeholder`,
      'objects',
    );
    expect(result.officeCount).toBe(offices[0]?.n);
    expect(result.officeCount).toBe(3);
    // The user's row holds the precision and nothing of the point.
    const row = await userRow(user.id);
    expect(row.locationPrecision).toBe('exact');
    expect(JSON.stringify(row)).not.toContain(DEFAULT_FIXTURE_POINT.lat.toFixed(6));
    expect(JSON.stringify(row)).not.toContain(DEFAULT_FIXTURE_POINT.lng.toFixed(6));
    const stored = await testApp.deps.db.execute<{ district_id: string; created_at: Date }>(
      sql`select * from user_districts where user_id = ${user.id}`,
      'objects',
    );
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual(['created_at', 'district_id', 'user_id']);
  });
});
