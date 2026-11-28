import { users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { JOB_PAYLOADS, LEGAL_VERSIONS } from '@citizenrun/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// TEST-age-assurance, the server cases (L-age-consent, D-350, D-897, CTL-71, CTL-75).
const FLAG_CACHE_MS = 30_000;
// A birth year as four digits that are not part of a longer run of digits or hex letters.
const BIRTH_YEAR_PATTERN = /(?<![0-9a-f])2000(?![0-9a-f])/i;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

type Age = Record<string, unknown>;

function signup(age: Age, extra: Record<string, unknown> = {}) {
  return {
    age,
    agreements: {
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    },
    aiScreening: true,
    ...extra,
  };
}

const NONE = { method: 'none', sourceTier: null };
const STORE = { method: 'store_signal', sourceTier: 'confirmed' };

/** Email-code sign-in for `email` through the two routes, with `signup` when given. */
async function emailSignIn(
  email: string,
  details: unknown,
  options: TestRequestOptions = {},
): Promise<TestResponse> {
  const ip = freshIp();
  const started = await testApp.request.post('/v1/auth/email/start', {
    ...options,
    ip,
    body: { email },
  });
  expect(started.status).toBe(200);
  const { pendingToken } = await started.json<{ pendingToken: string }>();
  const code = testApp.fakes.mailer.codeFor(email);
  if (code === null) {
    throw new Error('No code was sent.');
  }
  return testApp.request.post('/v1/auth/email/verify', {
    ...options,
    ip,
    body: details === null ? { pendingToken, code } : { pendingToken, code, signup: details },
  });
}

async function userByEmail(email: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.email, email));
  return row;
}

async function userRow(id: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, id));
  if (row === undefined) {
    throw new Error('The user row is gone.');
  }
  return row;
}

async function errorOf(response: TestResponse) {
  return (await response.json<{ error: { code: string; fields: Record<string, string> } }>()).error;
}

async function setRule(state: string, signupRule: string, ageMethod: string): Promise<void> {
  await testApp.deps.db.execute(
    sql`update state_rules set signup = ${signupRule}, age_method = ${ageMethod} where state = ${state}`,
  );
  // Past the flag reader's cache.
  testApp.deps.clock.advance(FLAG_CACHE_MS);
}

async function deletionJobsFor(userId: string) {
  const jobs = await queuedJobs(testApp.deps.db, 'account.delete');
  return jobs
    .map((job) => JOB_PAYLOADS['account.delete'].parse(job.data))
    .filter((payload) => payload.userId === userId);
}

/** Every column of every row the user owns, as text, one string per row. */
async function storedTextOf(userId: string): Promise<string[]> {
  const rows = await testApp.deps.db.execute<{ text: string }>(
    sql`select row_to_json(u)::text as text from users u where u.id = ${userId}
        union all select row_to_json(a)::text from auth_identities a where a.user_id = ${userId}
        union all select row_to_json(c)::text from user_consents c where c.user_id = ${userId}
        union all select row_to_json(s)::text from sessions s where s.user_id = ${userId}
        union all select row_to_json(e)::text from app_events e where e.user_id = ${userId}`,
    'objects',
  );
  return rows.map((row) => row.text);
}

describe('TEST-age-assurance', () => {
  it('adult signal continues', async () => {
    const response = await emailSignIn('fixture-adult@example.test', signup(STORE), {
      client: 'ios/1.4.0',
    });
    expect(response.status).toBe(200);
    const row = await userByEmail('fixture-adult@example.test');
    expect(row?.ageMethod).toBe('store_signal');
    expect(row?.ageSourceTier).toBe('confirmed');
    expect(row?.ageResult).toBe('adult');
  });

  it('under 18 creates no account', async () => {
    // The phone stops sign-up on a minor signal and sends no sign-up details.
    const response = await emailSignIn('fixture-minor@example.test', null);
    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('signup_details_required');
    expect(await userByEmail('fixture-minor@example.test')).toBeUndefined();
    // A sign-up that claims a minor age is refused by the schema.
    const claimed = await emailSignIn(
      'fixture-minor@example.test',
      signup({ method: 'store_signal', sourceTier: 'under_18' }),
    );
    expect(claimed.status).toBe(400);
    expect(await userByEmail('fixture-minor@example.test')).toBeUndefined();
  });

  it('existing account under 18', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await testApp.request.post('/v1/me/age', {
      auth,
      body: { result: 'under_18', sourceTier: 'declared' },
    });
    expect(response.status).toBe(202);
    const row = await userRow(user.id);
    expect(row.suspendedReason).toBe('under_18');
    expect(row.status).toBe('deleting');
    expect(await deletionJobsFor(user.id)).toEqual([{ userId: user.id, skipDeferral: false }]);
  });

  it('web sign-up asks no age and records none', async () => {
    const now = testApp.deps.clock.now();
    const response = await emailSignIn('fixture-web@example.test', signup(NONE), {
      client: 'web/1.4.0',
    });
    expect(response.status).toBe(200);
    const info = await response.json<{ me: { age: unknown } }>();
    expect(info.me.age).toEqual({ method: 'none', sourceTier: null, checkedAt: now.toISOString() });
    const row = await userByEmail('fixture-web@example.test');
    expect(row).toMatchObject({
      ageMethod: 'none',
      ageResult: null,
      ageSourceTier: null,
      ageCheckedAt: now,
    });
  });

  it('a phone with no signal records none', async () => {
    const now = testApp.deps.clock.now();
    for (const [client, email] of [
      ['ios/1.4.0', 'fixture-ios@example.test'],
      ['android/1.4.0', 'fixture-android@example.test'],
    ] as const) {
      const response = await emailSignIn(email, signup(NONE), { client });
      expect(response.status, client).toBe(200);
      expect(await userByEmail(email), client).toMatchObject({
        ageMethod: 'none',
        ageResult: null,
        ageSourceTier: null,
        ageCheckedAt: now,
      });
    }
  });

  it('a web client cannot claim a store signal', async () => {
    const response = await emailSignIn('fixture-claim@example.test', signup(STORE), {
      client: 'web/1.4.0',
    });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).fields).toEqual({ 'signup.age.method': 'not_allowed' });
    expect(await userByEmail('fixture-claim@example.test')).toBeUndefined();
  });

  it('a self-declared age is refused, and a no-signal record takes no result or tier', async () => {
    const refused = [
      { method: 'self_declared', sourceTier: 'self' },
      { method: 'none', sourceTier: 'self' },
      { method: 'none', sourceTier: 'declared' },
      { method: 'none' },
    ];
    for (const [index, age] of refused.entries()) {
      // One address per attempt: an address is sent only so many codes.
      const email = `fixture-declared-${String(index)}@example.test`;
      const response = await emailSignIn(email, signup(age));
      expect(response.status, JSON.stringify(age)).toBe(400);
      expect((await errorOf(response)).code).toBe('invalid_request');
      expect(await userByEmail(email)).toBeUndefined();
    }
    // An unknown key is dropped: the record still claims no result.
    const claimed = await emailSignIn(
      'fixture-declared@example.test',
      signup({ ...NONE, result: 'adult' }),
    );
    expect(claimed.status).toBe(200);
    expect(await userByEmail('fixture-declared@example.test')).toMatchObject({
      ageMethod: 'none',
      ageResult: null,
      ageSourceTier: null,
    });
  });

  it('no birth date and no raw signal is stored or logged', async () => {
    for (const [email, age, client] of [
      ['fixture-none@example.test', NONE, 'web/1.4.0'],
      ['fixture-store@example.test', STORE, 'ios/1.4.0'],
    ] as const) {
      const response = await emailSignIn(
        email,
        signup({ ...age, birthMonth: 1, birthYear: 2000, rawSignal: 'fixture-raw-signal' }),
        { client },
      );
      expect(response.status).toBe(200);
      const row = await userByEmail(email);
      if (row === undefined) {
        throw new Error('The user was not created.');
      }
      expect(row.ageMethod).toBe(age.method);
      const stored = await storedTextOf(row.id);
      expect(stored.length).toBeGreaterThan(1);
      for (const text of stored) {
        expect(text).not.toMatch(BIRTH_YEAR_PATTERN);
        expect(text).not.toContain('birthMonth');
        expect(text).not.toContain('birthYear');
        expect(text).not.toContain('fixture-raw-signal');
      }
    }
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toMatch(BIRTH_YEAR_PATTERN);
      expect(line.raw).not.toContain('birthMonth');
      expect(line.raw).not.toContain('birthYear');
      expect(line.raw).not.toContain('fixture-raw-signal');
    }
  });

  it('per-state rules', async () => {
    await setRule('NC', 'withhold', 'store_signal_or_none');
    const withheld = await emailSignIn('fixture-nc@example.test', signup(NONE, { state: 'NC' }));
    expect(withheld.status).toBe(403);
    expect((await errorOf(withheld)).code).toBe('unavailable_in_state');
    expect(await userByEmail('fixture-nc@example.test')).toBeUndefined();

    await setRule('NC', 'allow', 'store_signal_required');
    const store = await emailSignIn('fixture-nc@example.test', signup(STORE, { state: 'NC' }));
    expect(store.status).toBe(200);
    expect((await userByEmail('fixture-nc@example.test'))?.ageMethod).toBe('store_signal');
  });

  it('store_signal_required still answers 422 when no signal comes', async () => {
    await setRule('NC', 'allow', 'store_signal_required');
    for (const platform of ['web', 'ios', 'android']) {
      const email = `fixture-required-${platform}@example.test`;
      const refused = await emailSignIn(email, signup(NONE, { state: 'NC' }), {
        client: `${platform}/1.4.0`,
      });
      expect(refused.status, platform).toBe(422);
      expect((await errorOf(refused)).code, platform).toBe('age_signal_required');
      expect(await userByEmail(email), platform).toBeUndefined();
    }
    // Another state keeps the default: no signal is needed there.
    const elsewhere = await emailSignIn(
      'fixture-required@example.test',
      signup(NONE, { state: 'VA' }),
    );
    expect(elsewhere.status).toBe(200);
    expect((await userByEmail('fixture-required@example.test'))?.ageMethod).toBe('none');
  });

  it('per-state rules at sign-up', async () => {
    // Every row at the launch default: no state is asked for.
    const open = await emailSignIn('fixture-open@example.test', signup(NONE));
    expect(open.status).toBe(200);

    await setRule('NC', 'withhold', 'store_signal_or_none');
    const stateless = await emailSignIn('fixture-stateless@example.test', signup(NONE));
    expect(stateless.status).toBe(400);
    expect((await errorOf(stateless)).fields).toEqual({ 'signup.state': 'required' });
    expect(await userByEmail('fixture-stateless@example.test')).toBeUndefined();
    const elsewhere = await emailSignIn(
      'fixture-stateless@example.test',
      signup(NONE, { state: 'VA' }),
    );
    expect(elsewhere.status).toBe(200);
  });

  it('under 13', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await testApp.request.post('/v1/me/age', {
      auth,
      body: { result: 'under_13', sourceTier: 'confirmed' },
    });
    expect(response.status).toBe(202);
    const row = await userRow(user.id);
    expect(row.suspendedReason).toBe('under_18');
    expect(row.suspendedAt).not.toBeNull();
    expect(row.status).toBe('deleting');
    const logged = testApp.logs.filter((line) => line.parsed['event'] === 'account.age_minor');
    expect(logged.map((line) => line.parsed['band'])).toEqual(['under_13']);
    expect(await deletionJobsFor(user.id)).toEqual([{ userId: user.id, skipDeferral: true }]);
  });
});
