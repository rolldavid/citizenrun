import {
  authChallenges,
  dataExports,
  emailCodes,
  rateLimits,
  reservedHandles,
  sessions,
  uploads,
  usageCounters,
  users,
} from '@citizenrun/db';
import {
  captureLogs,
  getTestDb,
  getTestObject,
  idAt,
  insertAppEvent,
  insertClientError,
  insertDataExport,
  insertRateCounter,
  insertUpload,
  insertUsageCounter,
  insertUser,
  putTestObject,
  resetStorage,
} from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { peekQueue, runJob } from '../../testing/job.ts';
import { RETENTION_RULES, cleanupRetention } from './retention.ts';
import type { RetentionRuleId } from './retention.ts';

// TEST-retention: for each rule a row just outside its limit goes and one just inside
// stays. Rows are dated by their own columns and ids (idAt); the job's clock is a FakeClock at the
// real time, so the database clock agrees with it within seconds.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The case of each rule; the meta-test reads this table, not the cases that ran. */
const RULE_CASES: Record<RetentionRuleId, string> = {
  H1: 'H1 rate-limit windows a day after they end',
  H2: 'H2 sign-in challenges a day after they expire',
  H3: 'H3 email codes after a day',
  H4: 'H4 unconsumed uploads after a day, with their objects',
  H5: 'H5 export files after a day',
  H9: 'H9 unfinished sign-ups are deleted',
  N1: 'N1 expired sessions and sessions past a year',
  N2: 'N2 released handles after their hold',
  N3: 'N3 upload rows a week after their object is gone',
  N4: 'N4 export rows after thirty days',
  N5: 'N5 client errors after fourteen days',
  N6: 'N6 app event partitions after 180 days',
  N7: 'N7 usage counters after 24 months',
};

type Classification =
  { rules: readonly RetentionRuleId[] } | 'permanent' | 'until_account_deleted' | { none: string };

/** Every table of schema `public` and how long its rows live. */
const RETENTION_CLASSIFICATION: Readonly<Record<string, Classification>> = {
  // Otherwise kept until the account is deleted.
  users: { rules: ['H9'] },
  email_codes: { rules: ['H3'] },
  sessions: { rules: ['N1'] },
  auth_challenges: { rules: ['H2'] },
  reserved_handles: { rules: ['N2'] },
  uploads: { rules: ['H4', 'N3'] },
  rate_limits: { rules: ['H1'] },
  usage_counters: { rules: ['N7'] },
  app_events: { rules: ['N6'] },
  data_exports: { rules: ['H5', 'N4'] },
  client_errors: { rules: ['N5'] },
  auth_identities: 'until_account_deleted',
  user_consents: 'until_account_deleted',
  user_issues: 'until_account_deleted',
  issues: 'permanent',
  powers: 'permanent',
  issue_powers: 'permanent',
  office_types: 'permanent',
  jurisdictions: 'permanent',
  districts: 'permanent',
  offices: 'permanent',
  elections: 'permanent',
  results: 'permanent',
  people: 'permanent',
  person_aliases: 'permanent',
  given_name_aliases: 'permanent',
  officeholders: 'permanent',
  candidacies: 'permanent',
  candidacy_filings: 'permanent',
  unmatched_filings: 'permanent',
  data_bundles: 'permanent',
  district_parts: { none: 'replaced by data loads, never by age' },
  district_fallbacks: { none: 'replaced by data loads, never by age' },
  district_display: { none: 'replaced by data loads, never by age' },
  zip_centroids: { none: 'replaced by data loads, never by age' },
  office_powers: { none: 'replaced by data loads, never by age' },
  filing_tracks: { none: 'replaced by data loads, never by age' },
  office_issues: { none: 'rebuilt from office powers by the scoring job' },
  bundle_changes: { none: 'pruned to the last seven loads by the bundle cleanup rule' },
  state_rules: 'permanent',
  worker_heartbeats: { none: 'one row, updated in place' },
  spatial_ref_sys: { none: 'PostGIS reference table' },
};

let sequence = 0;

// A fixture value no other row of the test holds.
function fixture(prefix: string): string {
  sequence += 1;
  return `fixture-${prefix}-${String(sequence)}`;
}

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

// The first instant of the UTC month `monthsBack` months before `at`.
function monthStart(at: Date, monthsBack: number): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - monthsBack, 1));
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

async function runScope(scope: 'hourly' | 'nightly', clock: FakeClock): Promise<void> {
  const result = await runJob(cleanupRetention, { scope }, { clock });
  expect(result.outcome).toBe('completed');
}

// The rows each rule reported in the log lines captured so far.
function ruleRows(): Record<string, number> {
  const rows: Record<string, number> = {};
  for (const line of captureLogs().lines) {
    if (line.parsed.event === 'retention.rule_done') {
      const { rule, rows: count } = line.parsed;
      if (typeof rule === 'string' && typeof count === 'number') {
        rows[rule] = count;
      }
    }
  }
  return rows;
}

async function insertSession(
  userId: string,
  values: { id?: string; expiresAt: Date },
): Promise<string> {
  const id = values.id ?? newId();
  await getTestDb()
    .insert(sessions)
    .values({
      id,
      userId,
      tokenHash: fixture('session-token-hash'),
      platform: 'ios',
      expiresAt: values.expiresAt,
    });
  return id;
}

async function insertChallenge(expiresAt: Date): Promise<string> {
  const id = newId();
  await getTestDb()
    .insert(authChallenges)
    .values({ id, kind: 'nonce', secretHash: fixture('challenge-hash'), expiresAt });
  return id;
}

async function insertEmailCode(createdAt: Date): Promise<string> {
  const id = idAt(createdAt);
  await getTestDb()
    .insert(emailCodes)
    .values({
      id,
      email: `${fixture('code')}.${marker()}@example.test`,
      pendingTokenHash: fixture('pending-token-hash'),
      codeHash: fixture('code-hash'),
      expiresAt: shift(createdAt, 10 * MINUTE_MS),
      lastSentAt: createdAt,
      createdAt,
    });
  return id;
}

async function insertReservedHandle(reservedUntil: Date): Promise<string> {
  const handleHash = fixture('handle-hash');
  await getTestDb()
    .insert(reservedHandles)
    .values({ handleHash, reason: 'released', reservedUntil });
  return handleHash;
}

// A user begun with no age record (the four age columns are null together).
async function insertUnfinishedUser(createdAt: Date): Promise<string> {
  const user = await insertUser(getTestDb(), {
    createdAt,
    ageMethod: null,
    ageResult: null,
    ageSourceTier: null,
    ageCheckedAt: null,
    onboardingStep: 'photo',
    onboardedAt: null,
  });
  return user.id;
}

async function putObject(key: string): Promise<void> {
  await putTestObject('media', key, new TextEncoder().encode('fixture object'), 'image/jpeg');
}

async function objectExists(key: string): Promise<boolean> {
  return (await getTestObject('media', key)) !== null;
}

// Creates the `app_events` partition of the UTC month starting at `start`, as the migration names
// it, unless it exists. Partitions outlive the per-test reset, so this never drops one. DDL takes
// no parameters, so the month travels as a transaction-local setting the block reads.
async function ensureEventPartition(start: Date): Promise<string> {
  await getTestDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('fixture.partition_month', ${isoDay(start)}, true)`);
    await tx.execute(
      sql`do $$
          declare
            lo date := current_setting('fixture.partition_month')::date;
            hi date := (lo + interval '1 month')::date;
          begin
            execute format(
              'create table if not exists %I partition of app_events for values from (%L) to (%L)',
              'app_events_' || to_char(lo, 'YYYYMM'),
              lo::text || ' 00:00:00+00',
              hi::text || ' 00:00:00+00');
          end
          $$`,
    );
  });
  return `app_events_${isoDay(start).slice(0, 4)}${isoDay(start).slice(5, 7)}`;
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await getTestDb().execute<{ found: string | null }>(
    sql`select to_regclass(${name})::text as found`,
    'objects',
  );
  return rows[0]?.found !== null && rows[0]?.found !== undefined;
}

async function count(table: string): Promise<number> {
  const rows = await getTestDb().execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
    'objects',
  );
  return rows[0]?.n ?? 0;
}

async function exists(
  table: typeof sessions | typeof authChallenges | typeof emailCodes | typeof dataExports,
  id: string,
): Promise<boolean> {
  const rows = await getTestDb().select({ id: table.id }).from(table).where(eq(table.id, id));
  return rows.length === 1;
}

describe('J-cleanup.retention', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it(RULE_CASES.H1, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const windows = [
      ['1m', MINUTE_MS],
      ['1h', HOUR_MS],
      ['1d', DAY_MS],
    ] as const;
    const expected: { key: string; kept: boolean }[] = [];
    for (const [suffix, length] of windows) {
      // A window ends `length` after it starts.
      const goneKey = `u:${newId()}:fixture:${suffix}`;
      await insertRateCounter(getTestDb(), {
        key: goneKey,
        windowStart: shift(now, -DAY_MS - MINUTE_MS - length),
      });
      const keptKey = `u:${newId()}:fixture:${suffix}`;
      await insertRateCounter(getTestDb(), {
        key: keptKey,
        windowStart: shift(now, -DAY_MS + MINUTE_MS - length),
      });
      expected.push({ key: goneKey, kept: false }, { key: keptKey, kept: true });
    }
    await runScope('hourly', clock);
    const left = await getTestDb().select({ key: rateLimits.key }).from(rateLimits);
    const keys = new Set(left.map((row) => row.key));
    expect(expected.map(({ key }) => ({ key, kept: keys.has(key) }))).toEqual(expected);
    expect(ruleRows()['H1']).toBe(3);
  });

  it(RULE_CASES.H2, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const gone = await insertChallenge(shift(now, -DAY_MS - MINUTE_MS));
    const kept = await insertChallenge(shift(now, -DAY_MS + MINUTE_MS));
    await runScope('hourly', clock);
    expect(await exists(authChallenges, gone)).toBe(false);
    expect(await exists(authChallenges, kept)).toBe(true);
    expect(ruleRows()['H2']).toBe(1);
  });

  it(RULE_CASES.H3, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const gone = await insertEmailCode(shift(now, -DAY_MS - MINUTE_MS));
    const kept = await insertEmailCode(shift(now, -DAY_MS + MINUTE_MS));
    await runScope('hourly', clock);
    expect(await exists(emailCodes, gone)).toBe(false);
    expect(await exists(emailCodes, kept)).toBe(true);
    expect(ruleRows()['H3']).toBe(1);
  });

  it(RULE_CASES.H4, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const stale = await insertUpload(getTestDb(), { createdAt: shift(now, -DAY_MS - MINUTE_MS) });
    const fresh = await insertUpload(getTestDb(), { createdAt: shift(now, -DAY_MS + MINUTE_MS) });
    const consumedAt = shift(now, -2 * DAY_MS + MINUTE_MS);
    const consumed = await insertUpload(getTestDb(), {
      createdAt: shift(now, -2 * DAY_MS),
      consumedAt,
    });
    for (const upload of [stale, fresh, consumed]) {
      await putObject(upload.key);
    }
    await runScope('hourly', clock);

    const rows = await getTestDb()
      .select({ id: uploads.id, objectDeletedAt: uploads.objectDeletedAt })
      .from(uploads);
    const deletedAt = new Map(rows.map((row) => [row.id, row.objectDeletedAt?.getTime() ?? null]));
    expect({
      stale: { object: await objectExists(stale.key), deletedAt: deletedAt.get(stale.id) },
      fresh: { object: await objectExists(fresh.key), deletedAt: deletedAt.get(fresh.id) },
      consumed: { object: await objectExists(consumed.key), deletedAt: deletedAt.get(consumed.id) },
    }).toEqual({
      stale: { object: false, deletedAt: now.getTime() },
      fresh: { object: true, deletedAt: null },
      consumed: { object: true, deletedAt: null },
    });
    expect(ruleRows()['H4']).toBe(1);
  });

  it(RULE_CASES.H5, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const stale = await insertDataExport(getTestDb(), {
      status: 'ready',
      readyAt: shift(now, -DAY_MS - MINUTE_MS),
    });
    const fresh = await insertDataExport(getTestDb(), {
      status: 'ready',
      readyAt: shift(now, -DAY_MS + MINUTE_MS),
    });
    for (const row of [stale, fresh]) {
      await putObject(row.objectKey ?? '');
    }
    await runScope('hourly', clock);

    const rows = await getTestDb()
      .select({ id: dataExports.id, status: dataExports.status })
      .from(dataExports);
    const status = new Map(rows.map((row) => [row.id, row.status]));
    expect({
      stale: { object: await objectExists(stale.objectKey ?? ''), status: status.get(stale.id) },
      fresh: { object: await objectExists(fresh.objectKey ?? ''), status: status.get(fresh.id) },
    }).toEqual({
      stale: { object: false, status: 'expired' },
      fresh: { object: true, status: 'ready' },
    });
    expect(ruleRows()['H5']).toBe(1);
  });

  it(RULE_CASES.H9, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const unfinished = await insertUnfinishedUser(shift(now, -25 * HOUR_MS));
    const young = await insertUnfinishedUser(shift(now, -23 * HOUR_MS));
    const signedIn = await insertUnfinishedUser(shift(now, -25 * HOUR_MS));
    const session = await insertSession(signedIn, { expiresAt: shift(now, 30 * DAY_MS) });
    const aged = (await insertUser(getTestDb(), { createdAt: shift(now, -25 * HOUR_MS) })).id;
    await runScope('hourly', clock);

    const rows = await getTestDb().select({ id: users.id, status: users.status }).from(users);
    const status = new Map(rows.map((row) => [row.id, row.status]));
    expect({
      unfinished: status.get(unfinished),
      young: status.get(young),
      signedIn: status.get(signedIn),
      aged: status.get(aged),
    }).toEqual({ unfinished: 'deleting', young: 'active', signedIn: 'active', aged: 'active' });
    const unfinishedSessions = await getTestDb()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, unfinished));
    expect(unfinishedSessions).toEqual([]);
    expect(await exists(sessions, session)).toBe(true);
    const jobs = await peekQueue('account.delete');
    expect(jobs.map((job) => job.data)).toEqual([{ userId: unfinished, skipDeferral: false }]);
    expect(ruleRows()['H9']).toBe(1);
    // Rows are counted, never named.
    expect(captureLogs().lines.some((line) => line.raw.includes(unfinished))).toBe(false);
  });

  it(RULE_CASES.N1, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const userId = (await insertUser(getTestDb())).id;
    const expired = await insertSession(userId, { expiresAt: shift(now, -MINUTE_MS) });
    const live = await insertSession(userId, { expiresAt: shift(now, MINUTE_MS) });
    const later = shift(now, 30 * DAY_MS);
    const pastYear = await insertSession(userId, {
      id: idAt(shift(now, -365 * DAY_MS - MINUTE_MS)),
      expiresAt: later,
    });
    const underYear = await insertSession(userId, {
      id: idAt(shift(now, -365 * DAY_MS + MINUTE_MS)),
      expiresAt: later,
    });
    await runScope('nightly', clock);
    expect({
      expired: await exists(sessions, expired),
      live: await exists(sessions, live),
      pastYear: await exists(sessions, pastYear),
      underYear: await exists(sessions, underYear),
    }).toEqual({ expired: false, live: true, pastYear: false, underYear: true });
    expect(ruleRows()['N1']).toBe(2);
  });

  it(RULE_CASES.N2, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const gone = await insertReservedHandle(shift(now, -MINUTE_MS));
    const kept = await insertReservedHandle(shift(now, MINUTE_MS));
    await runScope('nightly', clock);
    const rows = await getTestDb()
      .select({ handleHash: reservedHandles.handleHash })
      .from(reservedHandles);
    expect(rows.map((row) => row.handleHash)).toEqual([kept]);
    expect(rows.map((row) => row.handleHash)).not.toContain(gone);
    expect(ruleRows()['N2']).toBe(1);
  });

  it(RULE_CASES.N3, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const oldCreated = shift(now, -7 * DAY_MS - MINUTE_MS);
    const gone = await insertUpload(getTestDb(), {
      createdAt: oldCreated,
      objectDeletedAt: shift(oldCreated, DAY_MS),
    });
    const youngCreated = shift(now, -7 * DAY_MS + MINUTE_MS);
    const kept = await insertUpload(getTestDb(), {
      createdAt: youngCreated,
      objectDeletedAt: shift(youngCreated, DAY_MS),
    });
    const inUseCreated = shift(now, -8 * DAY_MS);
    const inUse = await insertUpload(getTestDb(), {
      createdAt: inUseCreated,
      consumedAt: shift(inUseCreated, MINUTE_MS),
    });
    await runScope('nightly', clock);
    const rows = await getTestDb().select({ id: uploads.id }).from(uploads);
    const ids = new Set(rows.map((row) => row.id));
    expect({ gone: ids.has(gone.id), kept: ids.has(kept.id), inUse: ids.has(inUse.id) }).toEqual({
      gone: false,
      kept: true,
      inUse: true,
    });
    expect(ruleRows()['N3']).toBe(1);
  });

  it(RULE_CASES.N4, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const gone = await insertDataExport(getTestDb(), {
      createdAt: shift(now, -30 * DAY_MS - MINUTE_MS),
      status: 'expired',
    });
    const kept = await insertDataExport(getTestDb(), {
      createdAt: shift(now, -30 * DAY_MS + MINUTE_MS),
      status: 'expired',
    });
    await runScope('nightly', clock);
    expect(await exists(dataExports, gone.id)).toBe(false);
    expect(await exists(dataExports, kept.id)).toBe(true);
    expect(ruleRows()['N4']).toBe(1);
  });

  it(RULE_CASES.N5, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const gone = await insertClientError(getTestDb(), {
      createdAt: shift(now, -14 * DAY_MS - MINUTE_MS),
    });
    const kept = await insertClientError(getTestDb(), {
      createdAt: shift(now, -13 * DAY_MS - 23 * HOUR_MS),
    });
    await runScope('nightly', clock);
    const rows = await getTestDb().execute<{ id: string }>(
      sql`select id::text as id from client_errors`,
      'objects',
    );
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
    expect(rows.map((row) => row.id)).not.toContain(gone.id);
    expect(ruleRows()['N5']).toBe(1);
  });

  it(RULE_CASES.N6, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const oldStart = monthStart(now, 8);
    const keptStart = monthStart(now, 5);
    const oldName = await ensureEventPartition(oldStart);
    const keptName = await ensureEventPartition(keptStart);
    await insertAppEvent(getTestDb(), { createdAt: shift(oldStart, 14 * DAY_MS) });
    const kept = await insertAppEvent(getTestDb(), { createdAt: shift(keptStart, 14 * DAY_MS) });
    await runScope('nightly', clock);
    expect(await tableExists(oldName)).toBe(false);
    expect(await tableExists(keptName)).toBe(true);
    const rows = await getTestDb().execute<{ id: number }>(
      sql`select id::int as id from ${sql.identifier(keptName)}`,
      'objects',
    );
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
    expect(ruleRows()['N6']).toBe(1);
  });

  it(RULE_CASES.N7, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const gone = isoDay(monthStart(now, 25));
    const kept = isoDay(monthStart(now, 23));
    await insertUsageCounter(getTestDb(), { name: 'email.month', period: gone, count: 5 });
    await insertUsageCounter(getTestDb(), { name: 'email.month', period: kept, count: 5 });
    await runScope('nightly', clock);
    const rows = await getTestDb().select({ period: usageCounters.period }).from(usageCounters);
    expect(rows.map((row) => row.period)).toEqual([kept]);
    expect(ruleRows()['N7']).toBe(1);
  });

  it('is idempotent', async () => {
    const clock = new FakeClock();
    const now = clock.now();
    // One row past the limit of every rule, and one within it.
    await insertRateCounter(getTestDb(), {
      key: `u:${newId()}:fixture:1h`,
      windowStart: shift(now, -2 * DAY_MS),
    });
    await insertRateCounter(getTestDb(), { key: `u:${newId()}:fixture:1h`, windowStart: now });
    await insertChallenge(shift(now, -2 * DAY_MS));
    await insertChallenge(shift(now, MINUTE_MS));
    await insertEmailCode(shift(now, -2 * DAY_MS));
    await insertEmailCode(now);
    const staleUpload = await insertUpload(getTestDb(), { createdAt: shift(now, -2 * DAY_MS) });
    await putObject(staleUpload.key);
    await insertUpload(getTestDb(), { createdAt: now });
    const staleExport = await insertDataExport(getTestDb(), {
      status: 'ready',
      readyAt: shift(now, -2 * DAY_MS),
    });
    await putObject(staleExport.objectKey ?? '');
    await insertDataExport(getTestDb(), { status: 'ready', readyAt: now });
    await insertUnfinishedUser(shift(now, -2 * DAY_MS));
    const userId = (await insertUser(getTestDb())).id;
    await insertSession(userId, { expiresAt: shift(now, -MINUTE_MS) });
    await insertSession(userId, { expiresAt: shift(now, DAY_MS) });
    await insertReservedHandle(shift(now, -MINUTE_MS));
    await insertReservedHandle(shift(now, DAY_MS));
    const oldUploadCreated = shift(now, -8 * DAY_MS);
    await insertUpload(getTestDb(), {
      createdAt: oldUploadCreated,
      objectDeletedAt: shift(oldUploadCreated, DAY_MS),
    });
    await insertDataExport(getTestDb(), {
      createdAt: shift(now, -31 * DAY_MS),
      status: 'expired',
    });
    await insertClientError(getTestDb(), { createdAt: shift(now, -15 * DAY_MS) });
    await insertClientError(getTestDb(), { createdAt: now });
    const oldStart = monthStart(now, 8);
    await ensureEventPartition(oldStart);
    await insertAppEvent(getTestDb(), { createdAt: shift(oldStart, DAY_MS) });
    await insertAppEvent(getTestDb(), { createdAt: now });
    await insertUsageCounter(getTestDb(), {
      name: 'email.month',
      period: isoDay(monthStart(now, 30)),
    });
    await insertUsageCounter(getTestDb(), {
      name: 'email.month',
      period: isoDay(monthStart(now, 0)),
    });

    const tables = Object.keys(RETENTION_CLASSIFICATION).filter(
      (table) => table !== 'spatial_ref_sys',
    );
    const snapshot = async (): Promise<Record<string, number>> => {
      const counts: Record<string, number> = {};
      for (const table of tables) {
        counts[table] = await count(table);
      }
      return counts;
    };

    await runScope('hourly', clock);
    await runScope('nightly', clock);
    const first = ruleRows();
    for (const rule of RETENTION_RULES) {
      expect({ rule: rule.id, changed: (first[rule.id] ?? 0) > 0 }).toEqual({
        rule: rule.id,
        changed: true,
      });
    }
    const afterFirst = await snapshot();
    const jobsAfterFirst = (await peekQueue('account.delete')).length;
    expect(jobsAfterFirst).toBe(1);

    captureLogs().clear();
    await runScope('hourly', clock);
    await runScope('nightly', clock);
    const second = ruleRows();
    expect(second).toEqual(Object.fromEntries(RETENTION_RULES.map((rule) => [rule.id, 0])));
    expect(await snapshot()).toEqual(afterFirst);
    expect((await peekQueue('account.delete')).length).toBe(jobsAfterFirst);
  });

  it('runs only the rules of its scope', async () => {
    const clock = new FakeClock();
    await runScope('hourly', clock);
    expect(Object.keys(ruleRows())).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H9']);
    captureLogs().clear();
    await runScope('nightly', clock);
    expect(Object.keys(ruleRows())).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7']);
  });

  it('every table with a retention rule has a case', async () => {
    const rows = await getTestDb().execute<{ name: string }>(
      sql`select c.relname::text as name
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
          order by 1`,
      'objects',
    );
    const tables = rows.map((row) => row.name);
    const ruleIds = new Set<string>(RETENTION_RULES.map((rule) => rule.id));

    const unclassified = tables.filter((table) => !(table in RETENTION_CLASSIFICATION));
    expect(unclassified).toEqual([]);

    const unknownRules: string[] = [];
    for (const [table, classification] of Object.entries(RETENTION_CLASSIFICATION)) {
      if (typeof classification === 'object' && 'rules' in classification) {
        for (const rule of classification.rules) {
          if (!ruleIds.has(rule)) {
            unknownRules.push(`${table}: ${rule}`);
          }
          // The rule names the table among those it ages.
          const found = RETENTION_RULES.find((entry) => entry.id === rule);
          if (found !== undefined && !found.tables.includes(table)) {
            unknownRules.push(`${table}: ${rule} does not age it`);
          }
        }
      } else if (typeof classification === 'object') {
        expect(classification.none.trim().length, table).toBeGreaterThan(0);
      }
    }
    expect(unknownRules).toEqual([]);

    // Every table a rule ages is classified under that rule.
    const unlisted = RETENTION_RULES.flatMap((rule) =>
      rule.tables.flatMap((table) => {
        const classification = RETENTION_CLASSIFICATION[table];
        const listed =
          typeof classification === 'object' &&
          'rules' in classification &&
          classification.rules.includes(rule.id);
        return listed ? [] : [`${rule.id}: ${table}`];
      }),
    );
    expect(unlisted).toEqual([]);

    const withoutCase = RETENTION_RULES.filter(
      (rule) =>
        !Object.hasOwn(RULE_CASES, rule.id) || !RULE_CASES[rule.id].startsWith(`${rule.id} `),
    ).map((rule) => rule.id);
    expect(withoutCase).toEqual([]);
  });
});
