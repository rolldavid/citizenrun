import { authIdentities, users } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { LEGAL_VERSIONS } from '@citizenrun/shared';
import type { SignupDetails } from '@citizenrun/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueOf } from '../../deps.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertIdentity } from '../../testing/factories.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import { applyExistingIdentity, resolveIdentity } from './resolve-identity.ts';
import type { IdentityInput, Resolution } from './resolve-identity.ts';
import { createUserWithIdentity } from './sign-up.ts';
import type { CreateResult } from './sign-up.ts';

// TEST-account-linking, built as TEST-auth-providers' linking matrix (CTL-14): each case resolves
// and then writes as the sign-in routes do, in one transaction, and asserts on rows.

const SIGNUP: SignupDetails = {
  age: { method: 'none', sourceTier: null },
  agreements: {
    termsVersion: LEGAL_VERSIONS.terms,
    contentPolicyVersion: LEGAL_VERSIONS.content_policy,
    privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
  },
};
const ADDRESS_HASH = 'fixture-address-hash';

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

function emailIdentity(email: string): IdentityInput {
  return {
    provider: 'email',
    subject: email,
    email,
    emailVerified: true,
    emailVerifiedAuthoritative: true,
    isPrivateEmail: null,
  };
}

function appleIdentity(
  subject: string,
  email: string,
  options: { relay?: boolean; verified?: boolean } = {},
): IdentityInput {
  const verified = options.verified ?? true;
  return {
    provider: 'apple',
    subject,
    email,
    emailVerified: verified,
    emailVerifiedAuthoritative: verified,
    isPrivateEmail: options.relay ?? false,
  };
}

// V for Google is the provider route's: a verified email of a Gmail account or one with an hd
// claim. The addresses here are fixtures; the flags stand for what the token said.
function googleIdentity(
  subject: string,
  email: string,
  options: { gmail?: boolean; hd: boolean },
): IdentityInput {
  return {
    provider: 'google',
    subject,
    email,
    emailVerified: true,
    emailVerifiedAuthoritative: options.gmail === true || options.hd,
    isPrivateEmail: null,
  };
}

type Outcome = { resolution: Resolution; userId: string | null; created: boolean };

/** Resolves and writes in one transaction, as a sign-in does. */
async function signInWith(input: IdentityInput, db: Db = testApp.deps.db): Promise<Outcome> {
  return db.transaction(async (tx): Promise<Outcome> => {
    const resolution = await resolveIdentity(tx, input);
    if (resolution.kind === 'existing') {
      await applyExistingIdentity(tx, input, resolution, {
        clientId: null,
        refreshTokenEnc: null,
        enqueue: enqueueOf(testApp.deps),
      });
      return { resolution, userId: resolution.userId, created: false };
    }
    if (resolution.kind === 'new') {
      const made = await createUserWithIdentity(tx, {
        identity: input,
        signup: SIGNUP,
        platform: 'ios',
        addrHash: ADDRESS_HASH,
        now: testApp.deps.clock.now(),
        name: null,
        clientId: null,
        refreshTokenEnc: null,
        method: input.provider,
      });
      if (made.kind === 'retry') {
        throw new Error('An unexpected race.');
      }
      return { resolution, userId: made.userId, created: true };
    }
    return { resolution, userId: null, created: false };
  });
}

async function userRow(id: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, id));
  return row;
}

async function identitiesOf(userId: string) {
  return testApp.deps.db.select().from(authIdentities).where(eq(authIdentities.userId, userId));
}

async function identity(provider: string, subject: string) {
  const [row] = await testApp.deps.db
    .select()
    .from(authIdentities)
    .where(
      sql`${authIdentities.provider} = ${provider} and ${authIdentities.subject} = ${subject}`,
    );
  return row;
}

describe('resolveIdentity and its writes', () => {
  it('row 1', async () => {
    const user = await insertUser(testApp.deps.db, {
      email: null,
      status: 'deleting',
      deletionRequestedAt: testApp.deps.clock.now(),
    });
    await insertIdentity(testApp.deps.db, {
      userId: user.id,
      provider: 'apple',
      subject: 'fixture-apple-row-1',
      email: 'row1@example.test',
    });
    const outcome = await signInWith(appleIdentity('fixture-apple-row-1', 'row1@example.test'));
    expect(outcome.resolution).toEqual({ kind: 'refused', code: 'account_deleting' });
  });

  it('row 2', async () => {
    const user = await insertUser(testApp.deps.db, { email: null });
    await insertIdentity(testApp.deps.db, {
      userId: user.id,
      provider: 'apple',
      subject: 'fixture-apple-row-2',
      email: 'old@example.test',
      emailVerified: false,
      isPrivateEmail: true,
    });
    const outcome = await signInWith(appleIdentity('fixture-apple-row-2', 'free@example.test'));
    expect(outcome.resolution).toEqual({ kind: 'existing', userId: user.id, attachedNow: false });
    expect(await identity('apple', 'fixture-apple-row-2')).toMatchObject({
      email: 'free@example.test',
      emailVerified: true,
      isPrivateEmail: false,
    });
    expect((await userRow(user.id))?.email).toBe('free@example.test');
    expect(await queuedJobs(testApp.deps.db, 'notify.email')).toEqual([]);

    // A null users.email stays null when another user holds the address.
    const holder = await insertUser(testApp.deps.db, { email: 'taken@example.test' });
    const second = await insertUser(testApp.deps.db, { email: null });
    await insertIdentity(testApp.deps.db, {
      userId: second.id,
      provider: 'google',
      subject: 'fixture-google-row-2',
      email: null,
      emailVerified: null,
    });
    const kept = await signInWith(
      googleIdentity('fixture-google-row-2', 'taken@example.test', { hd: true }),
    );
    expect(kept.resolution).toEqual({ kind: 'existing', userId: second.id, attachedNow: false });
    expect((await userRow(second.id))?.email).toBeNull();
    expect((await userRow(holder.id))?.email).toBe('taken@example.test');
    expect(await identity('google', 'fixture-google-row-2')).toMatchObject({
      email: 'taken@example.test',
      emailVerified: true,
    });
  });

  it('row 4', async () => {
    await insertUser(testApp.deps.db, {
      email: 'leaving@example.test',
      status: 'deleting',
      deletionRequestedAt: testApp.deps.clock.now(),
    });
    const outcome = await signInWith(
      googleIdentity('fixture-google-row-4', 'leaving@example.test', { hd: true }),
    );
    expect(outcome.resolution).toEqual({ kind: 'refused', code: 'account_deleting' });
    expect(await identity('google', 'fixture-google-row-4')).toBeUndefined();
  });

  it("row 5, email code for an Apple user's address", async () => {
    const email = 'apple-holder@example.test';
    const user = await insertUser(testApp.deps.db, { email });
    await testApp.deps.db.delete(authIdentities).where(eq(authIdentities.userId, user.id));
    await insertIdentity(testApp.deps.db, {
      userId: user.id,
      provider: 'apple',
      subject: 'fixture-apple-row-5',
      email,
    });
    const outcome = await signInWith(emailIdentity(email));
    expect(outcome.resolution).toEqual({ kind: 'existing', userId: user.id, attachedNow: true });
    const providers = (await identitiesOf(user.id)).map((row) => row.provider).sort();
    expect(providers).toEqual(['apple', 'email']);
    const jobs = await queuedJobs(testApp.deps.db, 'notify.email');
    expect(jobs.map((job) => job.data)).toEqual([
      { template: 'signin_method_added', userId: user.id, provider: 'email' },
    ]);
  });

  it('row 5, Google with gmail.com', async () => {
    const user = await insertUser(testApp.deps.db, { email: 'gmail-account@example.test' });
    const outcome = await signInWith(
      googleIdentity('fixture-google-gmail', 'gmail-account@example.test', {
        gmail: true,
        hd: false,
      }),
    );
    expect(outcome.resolution).toEqual({ kind: 'existing', userId: user.id, attachedNow: true });
    expect((await identity('google', 'fixture-google-gmail'))?.userId).toBe(user.id);
    expect(await queuedJobs(testApp.deps.db, 'notify.email')).toHaveLength(1);
  });

  it('row 5, Google with hd', async () => {
    const user = await insertUser(testApp.deps.db, { email: 'staff@example.test' });
    const outcome = await signInWith(
      googleIdentity('fixture-google-hd', 'staff@example.test', { hd: true }),
    );
    expect(outcome.resolution).toEqual({ kind: 'existing', userId: user.id, attachedNow: true });
    expect((await identity('google', 'fixture-google-hd'))?.userId).toBe(user.id);
  });

  it('row 7, Google on another domain without hd', async () => {
    const holder = await insertUser(testApp.deps.db, { email: 'someone@example.test' });
    const outcome = await signInWith(
      googleIdentity('fixture-google-row-7', 'someone@example.test', { hd: false }),
    );
    expect(outcome.resolution).toEqual({ kind: 'new' });
    expect(outcome.userId).not.toBe(holder.id);
    expect((await userRow(outcome.userId ?? ''))?.email).toBeNull();
    expect(await identity('google', 'fixture-google-row-7')).toMatchObject({
      userId: outcome.userId,
      email: 'someone@example.test',
      emailVerified: true,
    });
    expect((await identitiesOf(holder.id)).map((row) => row.provider)).toEqual(['email']);
    expect(await queuedJobs(testApp.deps.db, 'notify.email')).toEqual([]);
  });

  it('row 6, Apple relay with no matching user', async () => {
    const relay = 'relay-fixture-1@relay.example.test';
    const outcome = await signInWith(
      appleIdentity('fixture-apple-relay-6', relay, { relay: true }),
    );
    expect(outcome.resolution).toEqual({ kind: 'new' });
    expect((await userRow(outcome.userId ?? ''))?.email).toBe(relay);
    expect(await identity('apple', 'fixture-apple-relay-6')).toMatchObject({
      userId: outcome.userId,
      email: relay,
      isPrivateEmail: true,
    });
  });

  it('an Apple relay address never links', async () => {
    const relay = 'relay-fixture-2@relay.example.test';
    const holder = await insertUser(testApp.deps.db, { email: relay });
    const outcome = await signInWith(
      appleIdentity('fixture-apple-relay-link', relay, { relay: true }),
    );
    expect(outcome.resolution).toEqual({ kind: 'new' });
    expect(outcome.userId).not.toBe(holder.id);
    expect((await userRow(outcome.userId ?? ''))?.email).toBeNull();
    expect((await identitiesOf(holder.id)).map((row) => row.provider)).toEqual(['email']);
    expect(await queuedJobs(testApp.deps.db, 'notify.email')).toEqual([]);
  });

  it('a verified non-relay Apple address links', async () => {
    const user = await insertUser(testApp.deps.db, { email: 'linked@example.test' });
    const outcome = await signInWith(appleIdentity('fixture-apple-linked', 'linked@example.test'));
    expect(outcome.resolution).toEqual({ kind: 'existing', userId: user.id, attachedNow: true });
    expect((await identitiesOf(user.id)).map((row) => row.provider).sort()).toEqual([
      'apple',
      'email',
    ]);
  });

  it('two concurrent sign-ups for one email end with one user', async () => {
    const { db } = testApp.deps;
    const input = emailIdentity('race@example.test');
    let releaseFirst: () => void = () => undefined;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstCreated: () => void = () => undefined;
    const firstHasCreated = new Promise<void>((resolve) => {
      firstCreated = resolve;
    });

    const create = (tx: Parameters<Parameters<Db['transaction']>[0]>[0], addrHash: string) =>
      createUserWithIdentity(tx, {
        identity: input,
        signup: SIGNUP,
        platform: 'ios',
        addrHash,
        now: testApp.deps.clock.now(),
        name: null,
        clientId: null,
        refreshTokenEnc: null,
        method: 'email',
      });

    const first = db.transaction(async (tx) => {
      expect(await resolveIdentity(tx, input)).toEqual({ kind: 'new' });
      const made = await create(tx, 'fixture-address-a');
      firstCreated();
      await firstMayCommit;
      return made;
    });
    await firstHasCreated;

    const second = db.transaction(async (tx) => {
      expect(await resolveIdentity(tx, input)).toEqual({ kind: 'new' });
      const made: CreateResult = await create(tx, 'fixture-address-b');
      const again = await resolveIdentity(tx, input);
      if (again.kind === 'existing') {
        await applyExistingIdentity(tx, input, again, {
          clientId: null,
          refreshTokenEnc: null,
          enqueue: enqueueOf(testApp.deps),
        });
      }
      return { made, again };
    });

    // Let the first commit once the second waits on its row.
    for (let tries = 0; tries < 200; tries += 1) {
      const waiting = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'`,
        'objects',
      );
      if ((waiting[0]?.count ?? 0) > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    releaseFirst();

    const firstMade = await first;
    const { made, again } = await second;
    expect(firstMade.kind).toBe('created');
    expect(made).toEqual({ kind: 'retry' });
    const winner = firstMade.kind === 'created' ? firstMade.userId : '';
    expect(again).toEqual({ kind: 'existing', userId: winner, attachedNow: false });
    const rows = await db.select().from(users).where(eq(users.email, 'race@example.test'));
    expect(rows.map((row) => row.id)).toEqual([winner]);
    expect((await identitiesOf(winner)).map((row) => row.provider)).toEqual(['email']);
  });
});
