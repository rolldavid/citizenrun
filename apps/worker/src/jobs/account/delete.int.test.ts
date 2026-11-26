import { generateKeyPairSync } from 'node:crypto';
import {
  appEvents,
  authIdentities,
  createEnqueue,
  emailCodes,
  markAccountDeleting,
  rateLimits,
  reservedHandles,
  users,
} from '@citizenrun/db';
import {
  captureLogs,
  createTestBoss,
  getTestBucket,
  getTestDb,
  getTestObject,
  insertUser,
  listTestKeys,
  resetStorage,
} from '@citizenrun/db/testing';
import { HANDLE_HOLD_DAYS, JOB_PAYLOADS, newId } from '@citizenrun/shared';
import { keyedHash, loadKeyRing } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { FakeClock } from '@citizenrun/shared/testing';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { testWorkerEnv } from '../../testing/env.ts';
import type { EveryKind } from '../../testing/every-kind.ts';
import { insertEveryKind } from '../../testing/every-kind.ts';
import { CaptureMailer } from '../../testing/fakes/mailer.ts';
import { createFakeOutbound } from '../../testing/fakes/outbound.ts';
import type { FakeOutbound } from '../../testing/fakes/outbound.ts';
import { peekQueue, runJob } from '../../testing/job.ts';
import { accountDelete, userMediaPrefixes } from './delete.ts';

// TEST-account-deletion: the scenario, markAccountDeleting as DELETE /v1/me calls it, then the job.

const DAY_MS = 24 * 60 * 60 * 1000;

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
// The three Apple variables in the shapes the env module accepts; the key is made for this file.
const APPLE_ENV = {
  APPLE_TEAM_ID: 'FIXTURETM1',
  APPLE_KEY_ID: 'FIXTUREKY1',
  APPLE_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
};

// The tables the scenario fills and the job deletes or adds to.
const COVERED: readonly string[] = [
  'users',
  'auth_identities',
  'email_codes',
  'auth_challenges',
  'sessions',
  'user_consents',
  'user_issues',
  'uploads',
  'rate_limits',
  'app_events',
  'data_exports',
  'reserved_handles',
];

// The tables that hold no user's data, each with the reason.
const NOT_USER_DATA: Readonly<Record<string, string>> = {
  issues: 'the issue list a migration loads',
  powers: 'the list of powers a migration loads',
  issue_powers: 'issue links a migration loads',
  office_types: 'the office types a migration loads',
  jurisdictions: 'civic data loaded from public records',
  districts: 'civic data loaded from public records',
  district_parts: 'civic data loaded from public records',
  district_fallbacks: 'civic data loaded from public records',
  district_display: 'civic data loaded from public records',
  zip_centroids: 'civic data loaded from public records',
  offices: 'civic data loaded from public records',
  office_powers: 'civic data loaded from public records',
  office_issues: 'civic data loaded from public records',
  elections: 'civic data loaded from public records',
  filing_tracks: 'civic data loaded from public records',
  results: 'civic data loaded from public records',
  state_rules: 'per-state rules; the admin column is cleared by its foreign key',
  usage_counters: 'service counters with no user id',
  client_errors: 'error reports stored with no user id',
  worker_heartbeats: "the worker's health row",
  spatial_ref_sys: 'PostGIS reference table',
};

function testKeys(): KeyRing {
  const env = testWorkerEnv();
  return loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS);
}

async function scenario(clock: FakeClock): Promise<EveryKind> {
  return insertEveryKind(getTestDb(), await getTestBucket('media'), testKeys(), clock.now());
}

async function markDeleting(userId: string): Promise<void> {
  await getTestDb().transaction((tx) => markAccountDeleting(tx, userId));
}

function lines(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

function anyLineHolds(text: string): boolean {
  return captureLogs().lines.some((line) => line.raw.includes(text));
}

function appleAnswering(status: number, onCall?: () => Promise<void>): FakeOutbound {
  const fake = createFakeOutbound();
  fake.on('appleid.apple.com', 'POST', '/auth/revoke', async () => {
    await onCall?.();
    return { status };
  });
  return fake;
}

async function userCount(userId: string): Promise<number> {
  return (await getTestDb().select().from(users).where(eq(users.id, userId))).length;
}

async function rateKeysOf(userId: string): Promise<number> {
  const rows = await getTestDb()
    .select()
    .from(rateLimits)
    .where(and(gte(rateLimits.key, `u:${userId}:`), lt(rateLimits.key, `u:${userId};`)));
  return rows.length;
}

async function objectsOf(userId: string): Promise<string[]> {
  const keys: string[] = [];
  for (const prefix of userMediaPrefixes(userId)) {
    keys.push(...(await listTestKeys('media', prefix)));
  }
  return keys.sort();
}

// Every foreign key that references users, as table and column.
async function userForeignKeys(): Promise<{ table: string; column: string }[]> {
  return getTestDb().execute<{ table: string; column: string }>(
    sql`select c.conrelid::regclass::text as table, a.attname::text as column
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = 'public.users'::regclass
        order by 1, 2`,
    'objects',
  );
}

async function rowsHolding(table: string, column: string, userId: string): Promise<number> {
  const rows = await getTestDb().execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)}
        where ${sql.identifier(column)} = ${userId}::uuid`,
    'objects',
  );
  return rows[0]?.count ?? 0;
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-account.delete', () => {
  it('ends access at once', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    const db = getTestDb();
    const enqueue = createEnqueue(await createTestBoss());

    await db.transaction(async (tx) => {
      await markAccountDeleting(tx, kind.user.id);
      await enqueue('account.delete', { userId: kind.user.id, skipDeferral: false }, { tx });
    });

    const [user] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, kind.user.id));
    expect(user?.status).toBe('deleting');
    expect(await rowsHolding('sessions', 'user_id', kind.user.id)).toBe(0);
    expect(await rowsHolding('sessions', 'user_id', kind.other.id)).toBe(1);
    const queued = await peekQueue('account.delete');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.data).toEqual({ userId: kind.user.id, skipDeferral: false });
  });

  it('removes every row', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
      },
    );

    expect(result.outcome).toBe('completed');
    const foreignKeys = await userForeignKeys();
    expect(foreignKeys.map((key) => key.table)).toEqual(
      expect.arrayContaining(['auth_identities', 'sessions', 'uploads', 'data_exports']),
    );
    for (const { table, column } of foreignKeys) {
      expect(await rowsHolding(table, column, kind.user.id), `${table}.${column}`).toBe(0);
    }
    const events = await getTestDb()
      .select()
      .from(appEvents)
      .where(eq(appEvents.userId, kind.user.id));
    expect(events).toHaveLength(0);
    expect(await rateKeysOf(kind.user.id)).toBe(0);
    const codes = await getTestDb()
      .select()
      .from(emailCodes)
      .where(eq(emailCodes.email, kind.user.email));
    expect(codes).toHaveLength(0);
    expect(await userCount(kind.user.id)).toBe(0);
    expect(lines('account.deleted')).toEqual([
      expect.objectContaining({
        appleRevoked: 0,
        appleNotPossible: 1,
        emailCodes: 1,
        appEvents: 1,
        rateLimits: 2,
        objects: kind.objectKeys.user.length,
        handleReserved: 1,
      }),
    ]);
    // No line of the job names the user, the address or the handle.
    expect(anyLineHolds(kind.user.id)).toBe(false);
    expect(anyLineHolds(kind.user.email)).toBe(false);
    expect(anyLineHolds(kind.user.handle)).toBe(false);
  });

  it('reserves the handle for ninety days', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);

    await runJob(accountDelete, { userId: kind.user.id, skipDeferral: false }, { clock });

    const rows = await getTestDb().select().from(reservedHandles);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.handleHash).toBe(
      keyedHash(testKeys(), { kind: 'handle', handle: kind.user.handle.toLowerCase() }),
    );
    expect(rows[0]?.reason).toBe('deleted');
    expect(rows[0]?.reservedUntil.getTime()).toBe(
      clock.now().getTime() + HANDLE_HOLD_DAYS * DAY_MS,
    );
    expect(HANDLE_HOLD_DAYS).toBe(90);
  });

  it('removes their objects', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    expect(await objectsOf(kind.user.id)).toEqual([...kind.objectKeys.user].sort());
    expect(kind.objectKeys.user.length).toBeGreaterThan(0);
    await markDeleting(kind.user.id);

    await runJob(accountDelete, { userId: kind.user.id, skipDeferral: false }, { clock });

    for (const prefix of userMediaPrefixes(kind.user.id)) {
      expect(await listTestKeys('media', prefix), prefix).toEqual([]);
    }
  });

  it("keeps the other user's data", async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);

    await runJob(accountDelete, { userId: kind.user.id, skipDeferral: false }, { clock });

    const otherId = kind.other.id;
    expect(await userCount(otherId)).toBe(1);
    const expected: Record<string, number> = {
      auth_identities: 1,
      sessions: 1,
      user_consents: 4,
      user_issues: 3,
      uploads: 1,
      data_exports: 1,
    };
    for (const [table, count] of Object.entries(expected)) {
      expect(await rowsHolding(table, 'user_id', otherId), table).toBe(count);
    }
    expect(await rowsHolding('app_events', 'user_id', otherId)).toBe(1);
    expect(await rateKeysOf(otherId)).toBe(1);
    const [other] = await getTestDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, otherId));
    const codes = await getTestDb()
      .select()
      .from(emailCodes)
      .where(eq(emailCodes.email, other?.email ?? ''));
    expect(codes).toHaveLength(1);
    expect(await objectsOf(otherId)).toEqual([...kind.objectKeys.other].sort());
  });

  it('revokes the Apple token first', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);
    const userRowsAtCall: number[] = [];
    const fake = appleAnswering(200, async () => {
      userRowsAtCall.push(await userCount(kind.user.id));
    });

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        env: APPLE_ENV,
        outbound: fake.fetch,
      },
    );

    expect(result.outcome).toBe('completed');
    expect(fake.calls).toHaveLength(1);
    const form = new URLSearchParams(fake.calls[0]?.body ?? '');
    expect(form.get('client_id')).toBe('fixture.services.id');
    expect(form.get('token')).toBe(kind.apple.refreshToken);
    expect(form.get('token_type_hint')).toBe('refresh_token');
    expect(userRowsAtCall).toEqual([1]);
    expect(await userCount(kind.user.id)).toBe(0);
    expect(lines('apple.revoked')).toHaveLength(1);
    expect(anyLineHolds(kind.apple.refreshToken)).toBe(false);
    expect(anyLineHolds(kind.apple.subject)).toBe(false);
  });

  it('goes on when Apple refuses or holds no token', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await getTestDb()
      .insert(authIdentities)
      .values({ userId: kind.user.id, provider: 'apple', subject: `${kind.apple.subject}-bare` });
    await markDeleting(kind.user.id);
    const fake = appleAnswering(400);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        env: APPLE_ENV,
        outbound: fake.fetch,
      },
    );

    expect(result.outcome).toBe('completed');
    expect(fake.calls).toHaveLength(1);
    expect(await userCount(kind.user.id)).toBe(0);
    expect(
      lines('apple.revoke_not_possible')
        .map((line) => line.reason)
        .sort(),
    ).toEqual(['no_token', 'rejected']);
  });

  it('goes on when a stored token cannot be read', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await getTestDb()
      .update(authIdentities)
      .set({ refreshTokenEnc: new Uint8Array([1, 2, 3]) })
      .where(eq(authIdentities.subject, kind.apple.subject));
    await markDeleting(kind.user.id);
    const fake = appleAnswering(200);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      { clock, env: APPLE_ENV, outbound: fake.fetch },
    );

    expect(result.outcome).toBe('completed');
    expect(fake.calls).toHaveLength(0);
    expect(lines('apple.revoke_not_possible')).toEqual([
      expect.objectContaining({ reason: 'decrypt_failed' }),
    ]);
    expect(await userCount(kind.user.id)).toBe(0);
  });

  it('retries while Apple is down', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        env: APPLE_ENV,
        outbound: appleAnswering(503).fetch,
      },
    );

    expect(result.outcome).toBe('failed');
    expect(result.error).toMatchObject({ name: 'RetryableJobError' });
    expect(await userCount(kind.user.id)).toBe(1);
    expect(await rowsHolding('auth_identities', 'user_id', kind.user.id)).toBe(3);
    expect(await objectsOf(kind.user.id)).toEqual([...kind.objectKeys.user].sort());
    expect(await rateKeysOf(kind.user.id)).toBe(2);
    expect(await listTestKeys('backups', 'replay/')).toEqual([]);
  });

  it('makes no Apple call while its variables are unset', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);
    const fake = appleAnswering(200);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        outbound: fake.fetch,
      },
    );

    expect(result.outcome).toBe('completed');
    expect(fake.calls).toHaveLength(0);
    expect(lines('apple.revoke_not_possible')).toEqual([
      expect.objectContaining({ reason: 'not_configured' }),
    ]);
    expect(await userCount(kind.user.id)).toBe(0);
  });

  it('writes the replay entry', async () => {
    const clock = new FakeClock('2027-03-06T00:10:00.000Z');
    const kind = await scenario(new FakeClock());
    await markDeleting(kind.user.id);
    const jobId = newId();
    const createdOn = new Date('2027-03-05T23:55:00.000Z');

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        job: { id: jobId, createdOn },
      },
    );

    expect(result.outcome).toBe('completed');
    const key = `replay/deletions/2027-03-05/${jobId}.json`;
    expect(await listTestKeys('backups', 'replay/')).toEqual([key]);
    const text = new TextDecoder().decode((await getTestObject('backups', key)) ?? undefined);
    const userHash = keyedHash(testKeys(), { kind: 'user', userId: kind.user.id });
    expect(text).toBe(
      `{"v":1,"kind":"account_deleted","userHash":"${userHash}","at":"2027-03-05T23:55:00.000Z"}`,
    );
    expect(text).not.toContain(kind.user.id);
  });

  it('a retry writes the same replay bytes', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);
    const job = { id: newId(), createdOn: clock.now() };
    const mailer = new CaptureMailer();
    mailer.failNext('5xx');

    const first = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        job,
        mailer,
      },
    );
    expect(first.outcome).toBe('failed');
    expect(await userCount(kind.user.id)).toBe(1);
    const [key] = await listTestKeys('backups', 'replay/');
    const firstBytes = await getTestObject('backups', key ?? '');

    const second = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        job,
        mailer,
      },
    );

    expect(second.outcome).toBe('completed');
    expect(await listTestKeys('backups', 'replay/')).toEqual([key]);
    expect(await getTestObject('backups', key ?? '')).toEqual(firstBytes);
    expect(mailer.sent).toHaveLength(1);
    expect(await userCount(kind.user.id)).toBe(0);
  });

  it('sends the confirmation to the former address', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);
    const jobId = newId();

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        jobId,
      },
    );

    expect(result.outcome).toBe('completed');
    expect(result.mailer.sent).toHaveLength(1);
    const [email] = result.mailer.sent;
    expect(email?.to).toEqual([kind.user.email]);
    expect(email?.idempotencyKey).toBe(`job:${jobId}`);
    expect(email?.headers).toEqual({});
    expect(email?.subject.length).toBeGreaterThan(0);

    const bounced = await insertUser(getTestDb(), { emailStatus: 'bounced' });
    const silent = await insertUser(getTestDb(), { email: null });
    for (const user of [bounced, silent]) {
      await markDeleting(user.id);
      const quiet = await runJob(
        accountDelete,
        { userId: user.id, skipDeferral: false },
        {
          clock,
        },
      );
      expect(quiet.outcome).toBe('completed');
      expect(quiet.mailer.sent).toHaveLength(0);
      expect(await userCount(user.id)).toBe(0);
    }
  });

  it('deletes the account when the provider refuses the confirmation', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);
    const mailer = new CaptureMailer();
    mailer.failNext('4xx');

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      { clock, mailer },
    );

    expect(result.outcome).toBe('completed');
    expect(mailer.sent).toHaveLength(0);
    expect(lines('email.failed')).toEqual([
      expect.objectContaining({
        level: 'error',
        template: 'account_deleted',
        errorClass: 'PermanentJobError',
      }),
    ]);
    expect(await userCount(kind.user.id)).toBe(0);
  });

  it('leaves no cap counter behind', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
      },
    );

    expect(result.mailer.sent).toHaveLength(1);
    expect(await rateKeysOf(kind.user.id)).toBe(0);
  });

  it('is idempotent', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);
    const fake = appleAnswering(200);
    const payload = { userId: kind.user.id, skipDeferral: false };

    const first = await runJob(accountDelete, payload, {
      clock,
      env: APPLE_ENV,
      outbound: fake.fetch,
    });
    expect(first.outcome).toBe('completed');
    expect(fake.calls).toHaveLength(1);

    const second = await runJob(accountDelete, payload, {
      clock,
      env: APPLE_ENV,
      outbound: fake.fetch,
    });

    expect(second.outcome).toBe('completed');
    expect(fake.calls).toHaveLength(1);
    expect(second.mailer.sent).toHaveLength(0);
    expect(lines('account.delete.skipped')).toEqual([expect.objectContaining({ reason: 'gone' })]);
    expect(await getTestDb().select().from(reservedHandles)).toHaveLength(1);
  });

  it('skips an account that is not being deleted', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
      },
    );

    expect(result.outcome).toBe('completed');
    expect(result.mailer.sent).toHaveLength(0);
    const [user] = await getTestDb()
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, kind.user.id));
    expect(user?.status).toBe('active');
    expect(await rowsHolding('sessions', 'user_id', kind.user.id)).toBe(2);
    expect(await rateKeysOf(kind.user.id)).toBe(2);
    expect(await objectsOf(kind.user.id)).toEqual([...kind.objectKeys.user].sort());
    expect(lines('account.delete.skipped')).toEqual([
      expect.objectContaining({ reason: 'not_deleting' }),
    ]);
  });

  it('takes skipDeferral', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: true },
      {
        clock,
      },
    );

    expect(result.outcome).toBe('completed');
    expect(await userCount(kind.user.id)).toBe(0);
    expect(JOB_PAYLOADS['account.delete'].parse({ userId: kind.user.id })).toEqual({
      userId: kind.user.id,
      skipDeferral: false,
    });
  });

  it('stops at shutdown before it deletes anything', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    await markDeleting(kind.user.id);
    const abort = new AbortController();
    abort.abort();

    const result = await runJob(
      accountDelete,
      { userId: kind.user.id, skipDeferral: false },
      {
        clock,
        signal: abort.signal,
      },
    );

    expect(result.outcome).toBe('failed');
    expect(result.error).toMatchObject({ name: 'RetryableJobError', reason: 'shutdown' });
    expect(await userCount(kind.user.id)).toBe(1);
    expect(await objectsOf(kind.user.id)).toEqual([...kind.objectKeys.user].sort());
  });

  it('every table is classified', async () => {
    const rows = await getTestDb().execute<{ name: string }>(
      sql`select c.relname::text as name
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
          order by 1`,
      'objects',
    );
    const tables = rows.map((row) => row.name);
    const notUserData = Object.keys(NOT_USER_DATA);

    const unclassified = tables.filter(
      (table) => !COVERED.includes(table) && !notUserData.includes(table),
    );
    expect(unclassified).toEqual([]);
    expect(COVERED.filter((table) => notUserData.includes(table))).toEqual([]);
    const missing = [...COVERED, ...notUserData].filter(
      (table) => table !== 'spatial_ref_sys' && !tables.includes(table),
    );
    expect(missing).toEqual([]);
    for (const reason of Object.values(NOT_USER_DATA)) {
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });
});
