import { GetBucketCorsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, ensureBucket } from '@citizenrun/shared/storage';
import { marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import {
  captureLogs,
  createTestBoss,
  getTestBucket,
  getTestDb,
  getTestObject,
  insertAppEvent,
  insertConsent,
  insertDataExport,
  insertRateCounter,
  insertUpload,
  insertUsageCounter,
  insertUser,
  listTestKeys,
  putTestObject,
  resetDb,
  resetStorage,
  setUserIssues,
} from './index.ts';
import { bucketName, workerDatabaseName } from './names.ts';
import { PrivacyLeakError, scanForLeaks } from './scan.ts';
import { KEPT_ROWS_SCHEMA } from './worker.ts';
import { harnessSettings } from './settings.ts';
import { localCorsRules } from './storage.ts';

const slot = (): string => {
  const value = process.env.VITEST_POOL_ID;
  if (value === undefined) {
    throw new Error('VITEST_POOL_ID is not set');
  }
  return value;
};

async function one<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const rows = await getTestDb().execute<T>(query, 'objects');
  const row = rows[0];
  if (row === undefined) {
    throw new Error('The query returned no row');
  }
  return row;
}

describe('the database harness', () => {
  it('each worker has its own clone', async () => {
    const { stamp, runId, templateName } = inject('harness');
    const { name } = await one<{ name: string }>(sql`select current_database() as name`);
    expect(name).toBe(workerDatabaseName(stamp, runId, slot()));
    expect(name).not.toBe(templateName);
  });

  it('the template holds every migration', async () => {
    const { names } = await one<{ names: string }>(
      sql`select string_agg(extname, ',' order by extname) as names from pg_extension
          where extname in ('citext', 'pg_trgm', 'postgis', 'unaccent')`,
    );
    expect(names).toBe('citext,pg_trgm,postgis,unaccent');
    const { present } = await one<{ present: boolean }>(
      sql`select exists (select 1 from pg_namespace where nspname = 'pgboss') as present`,
    );
    expect(present).toBe(true);
  });

  it('resetDb empties tables', async () => {
    const db = getTestDb();
    await db.execute(sql`create table harness_probe (id int primary key)`);
    try {
      await db.execute(sql`insert into harness_probe (id) values (1)`);
      await resetDb();
      const { n } = await one<{ n: number }>(sql`select count(*)::int as n from harness_probe`);
      expect(n).toBe(0);
    } finally {
      await db.execute(sql`drop table if exists harness_probe`);
    }
  });

  it('statement timeout is 20 seconds', async () => {
    const row = await one<{ statement_timeout: string }>(sql`show statement_timeout`);
    expect(row.statement_timeout).toBe('20s');
  });

  it('buckets are per worker and empty after reset', async () => {
    const { runId } = inject('harness');
    const handle = await getTestBucket('media');
    expect(handle.bucket).toBe(bucketName(runId, slot(), 'media'));

    const bytes = new Uint8Array([1, 2, 3, 250]);
    await putTestObject('media', 'a/probe.bin', bytes, 'application/octet-stream');
    expect(await getTestObject('media', 'a/probe.bin')).toEqual(bytes);
    expect(await listTestKeys('media', 'a/')).toEqual(['a/probe.bin']);
    await resetStorage();
    expect(await listTestKeys('media', 'a/')).toEqual([]);
    expect(await getTestObject('media', 'a/missing.bin')).toBeNull();

    const cors = await handle.client.send(new GetBucketCorsCommand({ Bucket: handle.bucket }));
    expect(cors.CORSRules).toEqual(localCorsRules());
  });

  it('reset empties a bucket of this worker that this file has not used yet', async () => {
    // An earlier file on the same worker leaves an object behind in its own module graph.
    const { runId } = inject('harness');
    const bucket = bucketName(runId, slot(), 'legal');
    const client = createS3Client(harnessSettings().s3);
    try {
      await ensureBucket(client, bucket, { cors: { CORSRules: localCorsRules() } });
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: 'left/behind.bin', Body: new Uint8Array([7]) }),
      );
    } finally {
      client.destroy();
    }
    await resetStorage();
    expect(await listTestKeys('legal', '')).toEqual([]);
  });

  it('the scan fails a test that logs the marker', async () => {
    const logs = captureLogs();
    logs.sink(JSON.stringify({ note: marker() }));
    const error: unknown = await scanForLeaks(getTestDb()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrivacyLeakError);
    expect(error instanceof PrivacyLeakError ? error.findings : null).toEqual([
      { source: 'log line 1', pattern: 'marker' },
    ]);
    expect(String(error)).not.toContain(marker());
    logs.clear();
    await expect(scanForLeaks(getTestDb())).resolves.toBeUndefined();
  });

  it('the scan reads pg-boss job data', async () => {
    const boss = await createTestBoss();
    try {
      await boss.createQueue('harness-probe');
      await boss.send('harness-probe', { to: 'a@example.test' });
      const error: unknown = await scanForLeaks(getTestDb()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PrivacyLeakError);
      expect(error instanceof PrivacyLeakError ? error.findings : null).toEqual([
        { source: 'pgboss.job 1', pattern: 'email' },
      ]);
      await resetDb();
      await expect(scanForLeaks(getTestDb())).resolves.toBeUndefined();
    } finally {
      await boss.deleteQueue('harness-probe');
      await boss.stop({ graceful: false });
    }
  });

  it('resetDb keeps the issues', async () => {
    const user = await insertUser(getTestDb());
    await setUserIssues(getTestDb(), user.id);
    await resetDb();
    const { issues } = await one<{ issues: number }>(
      sql`select count(*)::int as issues from issues`,
    );
    expect(issues).toBe(19);
    const { picks } = await one<{ picks: number }>(
      sql`select count(*)::int as picks from user_issues`,
    );
    expect(picks).toBe(0);
  });

  it('resetDb restores state rules', async () => {
    const before = await stateRulesAsText();
    const db = getTestDb();
    await db.execute(sql`update state_rules set signup = 'withhold' where state = 'TX'`);
    await db.execute(sql`insert into state_rules (state) values ('YY')`);
    await db.execute(sql`delete from state_rules where state = 'MP'`);
    await resetDb();
    const after = await stateRulesAsText();
    expect(after.filter((row) => row.state !== 'ZZ')).toEqual(
      before.filter((row) => row.state !== 'ZZ'),
    );
    expect(after.filter((row) => row.state !== 'ZZ')).toHaveLength(56);
    expect(after.filter((row) => row.state !== 'ZZ')).toEqual(
      await stateRulesAsText(KEPT_ROWS_SCHEMA),
    );
    expect(after.some((row) => row.state === 'YY')).toBe(false);
    expect(after.some((row) => row.state === 'MP')).toBe(true);
    expect(after.filter((row) => row.state === 'ZZ')).toHaveLength(1);
  });

  it('resetDb survives the users cascade', async () => {
    const user = await insertUser(getTestDb());
    await getTestDb().execute(
      sql`update state_rules set updated_by = ${user.id} where state = 'CA'`,
    );
    await resetDb();
    const rules = await stateRulesAsText();
    expect(rules.filter((row) => row.state !== 'ZZ')).toHaveLength(56);
    expect(rules.find((row) => row.state === 'CA')).toBeDefined();
    expect(rules.every((row) => row.updated_by === null)).toBe(true);
  });

  it('resetDb empties the account tables and the partitioned log', async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    await insertConsent(db, { userId: user.id });
    await setUserIssues(db, user.id, [{ issueId: 'climate' }]);
    await insertUpload(db, { userId: user.id });
    await insertRateCounter(db, { key: `u:${user.id}:probe:1m`, windowStart: new Date(0) });
    await insertUsageCounter(db, { name: 'email.day', period: '2026-01-01' });
    await insertAppEvent(db, { userId: user.id });
    await insertDataExport(db, { userId: user.id });
    const tables = [
      'users',
      'auth_identities',
      'user_consents',
      'user_issues',
      'uploads',
      'rate_limits',
      'usage_counters',
      'app_events',
      'data_exports',
    ];
    for (const table of tables) {
      expect(await countRows(table)).toBe(1);
    }
    await resetDb();
    for (const table of tables) {
      expect(await countRows(table)).toBe(0);
    }
    const next = await insertAppEvent(db);
    expect(next.id).toBe(1);
  });

  it('resetDb restarts the identity of a table the test emptied itself', async () => {
    const db = getTestDb();
    await insertAppEvent(db);
    await db.execute(sql`delete from app_events`);
    await resetDb();
    const next = await insertAppEvent(db);
    expect(next.id).toBe(1);
  });

  it('resetDb leaves the file of a table that holds no row', async () => {
    const filenode = async (): Promise<number> =>
      (await one<{ node: number }>(sql`select pg_relation_filenode('public.users')::int as node`))
        .node;
    const before = await filenode();
    await resetDb();
    expect(await filenode()).toBe(before);
    await insertUser(getTestDb());
    await resetDb();
    expect(await filenode()).not.toBe(before);
  });
});

type StateRuleText = {
  state: string;
  signup: string;
  age_method: string;
  candidate_tools: boolean;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

// Every column of state_rules (or of the clone's kept copy), the timestamps as text, so a lost
// microsecond shows.
async function stateRulesAsText(schema = 'public'): Promise<StateRuleText[]> {
  return getTestDb().execute<StateRuleText>(
    sql`select state::text as state, signup, age_method, candidate_tools, updated_by::text as updated_by,
               updated_at::text as updated_at, created_at::text as created_at
        from ${sql.identifier(schema)}.state_rules order by state`,
    'objects',
  );
}

// The fixed table names of the test above, never a name from outside it.
async function countRows(table: string): Promise<number> {
  const { n } = await one<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return n;
}
