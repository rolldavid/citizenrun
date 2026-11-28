import { sessions, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { LEGAL_VERSIONS } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestResponse } from '../../testing/request.ts';

// CTL-65: the account states a request can move an account between. The move from deleting to
// deleted is the worker's (TEST-account-deletion).
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

function now(): Date {
  return testApp.deps.clock.now();
}

let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

const signup = {
  age: { method: 'none', sourceTier: null },
  agreements: {
    termsVersion: LEGAL_VERSIONS.terms,
    contentPolicyVersion: LEGAL_VERSIONS.content_policy,
    privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
  },
};

/** Email-code sign-in for `email` through the two routes, with `signup` when given. */
async function emailSignIn(email: string, details: unknown = null): Promise<TestResponse> {
  const ip = freshIp();
  const started = await testApp.request.post('/v1/auth/email/start', { ip, body: { email } });
  expect(started.status).toBe(200);
  const { pendingToken } = await started.json<{ pendingToken: string }>();
  const code = testApp.fakes.mailer.codeFor(email);
  if (code === null) {
    throw new Error('No code was sent.');
  }
  return testApp.request.post('/v1/auth/email/verify', {
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

async function errorCode(response: TestResponse): Promise<string> {
  return (await response.json<{ error: { code: string } }>()).error.code;
}

describe('account status', () => {
  it('sign-up makes an active account', async () => {
    const response = await emailSignIn('fixture-new@example.test', signup);
    expect(response.status).toBe(200);
    const row = await userByEmail('fixture-new@example.test');
    expect(row?.status).toBe('active');
    expect(row?.suspendedAt).toBeNull();
    expect(row?.deletionRequestedAt).toBeNull();
  });

  it('DELETE moves an active account to deleting', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
    expect((await testApp.request.delete('/v1/me', { auth })).status).toBe(202);
    const row = await userRow(user.id);
    expect(row.status).toBe('deleting');
    expect(row.deletionRequestedAt).not.toBeNull();
    expect(row.suspendedReason).toBeNull();
  });

  it('DELETE moves a suspended account to deleting', async () => {
    const user = await insertUser(testApp.deps.db, {
      status: 'suspended',
      suspendedAt: new Date(now().getTime() - DAY_MS),
      suspendedReason: 'spam',
    });
    const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
    expect((await testApp.request.delete('/v1/me', { auth })).status).toBe(202);
    const row = await userRow(user.id);
    expect(row.status).toBe('deleting');
    // The suspension stays recorded: the deletion job reads it.
    expect(row.suspendedReason).toBe('spam');
    expect(row.suspendedAt).not.toBeNull();
  });

  it('an under-18 signal moves an active account to deleting with the under_18 reason', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await testApp.request.post('/v1/me/age', {
      auth,
      body: { result: 'under_18', sourceTier: 'declared' },
    });
    expect(response.status).toBe(202);
    const row = await userRow(user.id);
    expect(row.status).toBe('deleting');
    expect(row.suspendedReason).toBe('under_18');
    expect(row.suspendedAt?.toISOString()).toBe(now().toISOString());
  });

  it('deleting is final: sign-in is refused', async () => {
    const user = await insertUser(testApp.deps.db, { email: 'fixture-final@example.test' });
    const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
    expect((await testApp.request.delete('/v1/me', { auth })).status).toBe(202);
    const refused = await emailSignIn('fixture-final@example.test');
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe('account_deleting');
    // Sign-up details do not bring the account back either.
    const again = await emailSignIn('fixture-final@example.test', signup);
    expect(again.status).toBe(403);
    expect(await errorCode(again)).toBe('account_deleting');
    expect((await userRow(user.id)).status).toBe('deleting');
    expect(
      await testApp.deps.db.select().from(sessions).where(eq(sessions.userId, user.id)),
    ).toEqual([]);
  });

  it("a suspended user's GET works and POST is 403", async () => {
    const user = await insertUser(testApp.deps.db, {
      status: 'suspended',
      suspendedAt: new Date(now().getTime() - HOUR_MS),
      suspendedReason: 'spam',
    });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    expect((await testApp.request.get('/v1/me', { auth })).status).toBe(200);
    expect((await testApp.request.get('/v1/me/export', { auth })).status).toBe(200);
    const skip = await testApp.request.post('/v1/me/onboarding/skip', {
      auth,
      body: { step: 'photo' },
    });
    expect(skip.status).toBe(403);
    expect(await errorCode(skip)).toBe('account_suspended');
    const patch = await testApp.request.patch('/v1/me', { auth, body: { name: 'Changed' } });
    expect(patch.status).toBe(403);
    expect(await errorCode(patch)).toBe('account_suspended');
    expect((await userRow(user.id)).status).toBe('suspended');
  });
});
