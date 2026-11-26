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

// TEST-age-assurance, the server cases (L-age-consent, D-350, CTL-71, CTL-75).
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

const SELF = { method: 'self_declared', sourceTier: 'self' };
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

  it('date-of-birth fallback', async () => {
    const response = await emailSignIn(
      'fixture-dob@example.test',
      signup({ ...SELF, birthMonth: 1, birthYear: 2000 }),
    );
    expect(response.status).toBe(200);
    const row = await userByEmail('fixture-dob@example.test');
    if (row === undefined) {
      throw new Error('The user was not created.');
    }
    expect(row.ageMethod).toBe('self_declared');
    expect(row.ageSourceTier).toBe('self');
    const stored = await storedTextOf(row.id);
    expect(stored.length).toBeGreaterThan(1);
    for (const text of stored) {
      expect(text).not.toMatch(BIRTH_YEAR_PATTERN);
      expect(text).not.toContain('birthMonth');
      expect(text).not.toContain('birthYear');
    }
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toMatch(BIRTH_YEAR_PATTERN);
      expect(line.raw).not.toContain('birthMonth');
      expect(line.raw).not.toContain('birthYear');
    }
  });

  it('per-state rules', async () => {
    await setRule('NC', 'withhold', 'store_signal_or_dob');
    const withheld = await emailSignIn('fixture-nc@example.test', signup(SELF, { state: 'NC' }));
    expect(withheld.status).toBe(403);
    expect((await errorOf(withheld)).code).toBe('unavailable_in_state');
    expect(await userByEmail('fixture-nc@example.test')).toBeUndefined();

    await setRule('NC', 'allow', 'store_signal_required');
    const declared = await emailSignIn('fixture-nc@example.test', signup(SELF, { state: 'NC' }));
    expect(declared.status).toBe(422);
    expect((await errorOf(declared)).code).toBe('age_signal_required');
    expect(await userByEmail('fixture-nc@example.test')).toBeUndefined();
    const store = await emailSignIn('fixture-nc@example.test', signup(STORE, { state: 'NC' }));
    expect(store.status).toBe(200);
    expect((await userByEmail('fixture-nc@example.test'))?.ageMethod).toBe('store_signal');
  });

  it('per-state rules at sign-up', async () => {
    // Every row at the launch default: no state is asked for.
    const open = await emailSignIn('fixture-open@example.test', signup(SELF));
    expect(open.status).toBe(200);

    await setRule('NC', 'withhold', 'store_signal_or_dob');
    const stateless = await emailSignIn('fixture-stateless@example.test', signup(SELF));
    expect(stateless.status).toBe(400);
    expect((await errorOf(stateless)).fields).toEqual({ 'signup.state': 'required' });
    expect(await userByEmail('fixture-stateless@example.test')).toBeUndefined();
    const elsewhere = await emailSignIn(
      'fixture-stateless@example.test',
      signup(SELF, { state: 'VA' }),
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
