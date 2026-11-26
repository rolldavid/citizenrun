import {
  authChallenges,
  bundleChanges,
  dataExports,
  fieldReports,
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
  getTestBucket,
  getTestDb,
  getTestObject,
  idAt,
  insertAppEvent,
  insertBundleChange,
  insertClientError,
  insertDataBundle,
  insertDataExport,
  insertFieldReport,
  insertRateCounter,
  insertUpload,
  insertUsageCounter,
  insertUser,
  listTestKeys,
  putTestObject,
  resetStorage,
} from '@citizenrun/db/testing';
import { BUNDLE_SCHEMA_VERSION, BundleManifestSchema, newId } from '@citizenrun/shared';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteKeys } from '../../lib/bucket-ops.ts';
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
  N8: 'N8 bundle changes of the last seven loads',
  N9: 'N9 bundle files after thirty days',
  N11: 'N11 field-report exports after ninety days',
  N12: 'N12 field reports a year after the decision',
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
  user_districts: 'until_account_deleted',
  follows: 'until_account_deleted',
  bookmarks: 'until_account_deleted',
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
  admin_actions: 'permanent',
  district_parts: { none: 'replaced by data loads, never by age' },
  district_fallbacks: { none: 'replaced by data loads, never by age' },
  district_display: { none: 'replaced by data loads, never by age' },
  zip_centroids: { none: 'replaced by data loads, never by age' },
  office_powers: { none: 'replaced by data loads, never by age' },
  filing_tracks: { none: 'replaced by data loads, never by age' },
  office_issues: { none: 'rebuilt from office powers by the scoring job' },
  bundle_changes: { rules: ['N8'] },
  field_reports: { rules: ['N12'] },
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

// A bundle version at `at`: `YYYYMMDDTHHMMSSZ-<kind>` (B-manifest "Version").
function versionAt(at: Date, kind: 'full' | 'filings' | 'geometry'): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z-${kind}`;
}

// A manifest that parses with BundleManifestSchema: a full bundle naming its geometry version, or
// a geometry bundle whose files are at the given paths.
function manifestBytes(
  version: string,
  options: { geometryVersion?: string | null; paths?: readonly string[] } = {},
): Uint8Array {
  const kind = version.endsWith('-geometry') ? 'geometry' : 'full';
  const manifest = BundleManifestSchema.parse({
    format: 'citizenrun-bundle',
    kind,
    version,
    schema_version: BUNDLE_SCHEMA_VERSION,
    schema_revision: 0,
    created_at: '2027-01-01T00:00:00.000Z',
    git_sha: '0'.repeat(40),
    geometry_version: options.geometryVersion ?? null,
    tiger_vintage: kind === 'geometry' ? '2024' : null,
    states: ['ZZ'],
    files: (options.paths ?? []).map((path) => ({
      name: 'geometry',
      state: 'ZZ',
      path,
      sha256: '0'.repeat(64),
      bytes: 1,
      rows: 1,
    })),
    assets: [],
    datasets: {},
    checks: [],
    filing_sources: [],
    two_source_fields: 0,
    coverage_path: null,
    attribution_path: null,
  });
  return new TextEncoder().encode(JSON.stringify(manifest));
}

async function putDataObject(key: string, bytes?: Uint8Array): Promise<void> {
  await putTestObject(
    'data',
    key,
    bytes ?? new TextEncoder().encode('fixture object'),
    'application/octet-stream',
  );
}

// A bundle folder with one data file and, unless null, a manifest.
async function putBundleFolder(version: string, manifest: Uint8Array | null): Promise<void> {
  const file = version.endsWith('-geometry') ? 'geometry/ZZ.ndjson.gz' : 'offices.ndjson.gz';
  await putDataObject(`bundles/${version}/${file}`);
  if (manifest !== null) {
    await putDataObject(`bundles/${version}/manifest.json`, manifest);
  }
}

// The bundle versions with any object left in the data bucket.
async function bundleVersionsLeft(): Promise<string[]> {
  const keys = await listTestKeys('data', 'bundles/');
  return [...new Set(keys.map((key) => key.split('/')[1] ?? ''))].sort();
}

async function bundleChangeIds(bundleId: string): Promise<number[]> {
  const rows = await getTestDb()
    .select({ id: bundleChanges.id })
    .from(bundleChanges)
    .where(eq(bundleChanges.bundleId, bundleId));
  return rows.map((row) => row.id);
}

function yearsBefore(at: Date, years: number): Date {
  const shifted = new Date(at);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - years);
  return shifted;
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

  it(RULE_CASES.N8, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const loaded: string[] = [];
    // Eight loaded full bundles, oldest first, two changes each.
    for (let index = 0; index < 8; index += 1) {
      const bundle = await insertDataBundle(getTestDb(), {
        status: 'loaded',
        loadedAt: shift(now, -(8 - index) * DAY_MS),
      });
      loaded.push(bundle.id);
      await insertBundleChange(getTestDb(), { bundleId: bundle.id });
      await insertBundleChange(getTestDb(), { bundleId: bundle.id });
    }
    const reverted = await insertDataBundle(getTestDb(), {
      status: 'reverted',
      loadedAt: shift(now, -HOUR_MS),
    });
    await insertBundleChange(getTestDb(), { bundleId: reverted.id });
    // A load whose upsert committed and whose geometry is pending, older than the seven.
    const loading = await insertDataBundle(getTestDb(), { status: 'loading', loadedAt: null });
    await insertBundleChange(getTestDb(), { bundleId: loading.id });
    await runScope('nightly', clock);

    const [oldest, ...newest] = loaded;
    expect(await bundleChangeIds(oldest ?? '')).toEqual([]);
    expect(await bundleChangeIds(reverted.id)).toEqual([]);
    for (const id of newest) {
      expect((await bundleChangeIds(id)).length, id).toBe(2);
    }
    expect((await bundleChangeIds(loading.id)).length).toBe(1);
    expect(ruleRows()['N8']).toBe(3);
  });

  it(RULE_CASES.N9, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const daysAgo = (days: number, kind: 'full' | 'geometry', minutes = 0): string =>
      versionAt(shift(now, -days * DAY_MS - minutes * MINUTE_MS), kind);

    const unloaded31 = daysAgo(31, 'full');
    const recent29 = daysAgo(29, 'full');
    const loadedOlder = daysAgo(45, 'full');
    const loadedA = daysAgo(40, 'full', 1);
    const loadedB = daysAgo(40, 'full', 2);
    const held40 = daysAgo(40, 'full', 3);
    const geometryNamed = daysAgo(40, 'geometry', 4);
    const geometryEarlier = daysAgo(50, 'geometry');
    const geometryOrphan = daysAgo(40, 'geometry', 5);

    await putBundleFolder(unloaded31, manifestBytes(unloaded31));
    await putBundleFolder(recent29, manifestBytes(recent29));
    await putBundleFolder(loadedOlder, manifestBytes(loadedOlder));
    await putBundleFolder(loadedA, manifestBytes(loadedA));
    await putBundleFolder(loadedB, manifestBytes(loadedB, { geometryVersion: geometryNamed }));
    await putBundleFolder(held40, manifestBytes(held40));
    await putBundleFolder(
      geometryNamed,
      manifestBytes(geometryNamed, {
        paths: ['geometry/ZZ.ndjson.gz', `../${geometryEarlier}/geometry/ZZ.ndjson.gz`],
      }),
    );
    await putBundleFolder(geometryEarlier, manifestBytes(geometryEarlier));
    await putBundleFolder(geometryOrphan, manifestBytes(geometryOrphan));
    const untouched = [
      'bundles/index/full.json',
      'bundles/notes/readme.txt',
      `assets/photos/${'a'.repeat(64)}.jpg`,
    ];
    for (const key of untouched) {
      await putDataObject(key);
    }

    for (const [version, loadedAt] of [
      [loadedOlder, shift(now, -45 * DAY_MS)],
      [loadedA, shift(now, -40 * DAY_MS)],
      [loadedB, shift(now, -40 * DAY_MS)],
    ] as const) {
      await insertDataBundle(getTestDb(), { version, status: 'loaded', loadedAt });
    }
    await insertDataBundle(getTestDb(), { version: held40, status: 'held', loadedAt: null });
    // The seed's sample row sorts above every real version and never takes a place (D-458).
    await insertDataBundle(getTestDb(), {
      version: 'sample-20270101T000000Z-full',
      status: 'loaded',
      loadedAt: now,
    });
    await runScope('nightly', clock);

    expect(await bundleVersionsLeft()).toEqual(
      [recent29, loadedA, loadedB, held40, geometryNamed, geometryEarlier, 'index', 'notes'].sort(),
    );
    for (const key of untouched) {
      expect(await getTestObject('data', key), key).not.toBeNull();
    }
    // Two objects in each of the three folders deleted.
    expect(ruleRows()['N9']).toBe(6);
    expect(
      captureLogs().lines.some((line) => line.parsed.event === 'retention.manifest_unreadable'),
    ).toBe(false);
  });

  it('N9 keeps every geometry folder when a kept manifest is unreadable', async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const loaded = versionAt(shift(now, -40 * DAY_MS), 'full');
    const geometryOld = versionAt(shift(now, -40 * DAY_MS - MINUTE_MS), 'geometry');
    const geometryOlder = versionAt(shift(now, -60 * DAY_MS), 'geometry');
    await putBundleFolder(loaded, new TextEncoder().encode('fixture, not JSON'));
    await putBundleFolder(geometryOld, manifestBytes(geometryOld));
    await putBundleFolder(geometryOlder, manifestBytes(geometryOlder));
    await insertDataBundle(getTestDb(), {
      version: loaded,
      status: 'loaded',
      loadedAt: shift(now, -40 * DAY_MS),
    });
    await runScope('nightly', clock);

    expect(await bundleVersionsLeft()).toEqual([loaded, geometryOld, geometryOlder].sort());
    const unreadable = captureLogs().lines.filter(
      (line) => line.parsed.event === 'retention.manifest_unreadable',
    );
    expect(unreadable.map((line) => line.parsed.version)).toEqual([loaded]);
    expect(ruleRows()['N9']).toBe(0);
  });

  it('N9 reads a folder with no object left as no folder', async () => {
    const clock = new FakeClock();
    const now = clock.now();
    // A recent full folder whose objects are gone; the local store may still list it.
    const emptied = versionAt(shift(now, -2 * DAY_MS - 7 * MINUTE_MS), 'full');
    await putBundleFolder(emptied, manifestBytes(emptied));
    await deleteKeys(
      await getTestBucket('data'),
      await listTestKeys('data', `bundles/${emptied}/`),
    );
    const orphan = versionAt(shift(now, -40 * DAY_MS - 7 * MINUTE_MS), 'geometry');
    await putBundleFolder(orphan, manifestBytes(orphan));
    await runScope('nightly', clock);

    expect(await listTestKeys('data', `bundles/${orphan}/`)).toEqual([]);
    const unreadable = captureLogs().lines.filter(
      (line) => line.parsed.event === 'retention.manifest_unreadable',
    );
    expect(unreadable.map((line) => line.parsed.version)).not.toContain(emptied);
    expect(ruleRows()['N9']).toBe(2);
  });

  it(RULE_CASES.N11, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const dayKey = (days: number): string =>
      `field-reports/${isoDay(shift(now, -days * DAY_MS))}/x.ndjson.gz`;
    for (const days of [91, 90, 89]) {
      await putDataObject(dayKey(days));
    }
    await putDataObject('field-reports/not-a-date/x.ndjson.gz');
    await runScope('nightly', clock);
    expect(await listTestKeys('data', 'field-reports/')).toEqual(
      [dayKey(90), dayKey(89), 'field-reports/not-a-date/x.ndjson.gz'].sort(),
    );
    expect(ruleRows()['N11']).toBe(1);
  });

  it(RULE_CASES.N12, async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const yearAgo = yearsBefore(now, 1);
    const gone = await insertFieldReport(getTestDb(), {
      status: 'fixed',
      decidedAt: shift(yearAgo, -MINUTE_MS),
    });
    const kept = await insertFieldReport(getTestDb(), {
      status: 'rejected',
      decidedAt: shift(yearAgo, MINUTE_MS),
    });
    const open = await insertFieldReport(getTestDb(), { createdAt: shift(now, -3 * 365 * DAY_MS) });
    await runScope('nightly', clock);
    const rows = await getTestDb().select({ id: fieldReports.id }).from(fieldReports);
    const ids = new Set(rows.map((row) => row.id));
    expect({ gone: ids.has(gone.id), kept: ids.has(kept.id), open: ids.has(open.id) }).toEqual({
      gone: false,
      kept: true,
      open: true,
    });
    expect(ruleRows()['N12']).toBe(1);
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
    const reverted = await insertDataBundle(getTestDb(), { status: 'reverted', loadedAt: now });
    await insertBundleChange(getTestDb(), { bundleId: reverted.id });
    const kept = await insertDataBundle(getTestDb(), { status: 'loaded', loadedAt: now });
    await insertBundleChange(getTestDb(), { bundleId: kept.id });
    await putBundleFolder(versionAt(shift(now, -40 * DAY_MS), 'full'), null);
    await putDataObject(`field-reports/${isoDay(shift(now, -100 * DAY_MS))}/x.ndjson.gz`);
    await putDataObject(`field-reports/${isoDay(now)}/x.ndjson.gz`);
    await insertFieldReport(getTestDb(), {
      status: 'fixed',
      decidedAt: yearsBefore(now, 2),
    });
    await insertFieldReport(getTestDb(), { status: 'fixed', decidedAt: now });

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
    expect(Object.keys(ruleRows())).toEqual([
      'N1',
      'N2',
      'N3',
      'N4',
      'N5',
      'N6',
      'N7',
      'N8',
      'N9',
      'N11',
      'N12',
    ]);
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
