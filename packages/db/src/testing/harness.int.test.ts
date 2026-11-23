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
  listTestKeys,
  putTestObject,
  resetDb,
  resetStorage,
} from './index.ts';
import { bucketName, workerDatabaseName } from './names.ts';
import { PrivacyLeakError, scanForLeaks } from './scan.ts';
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
});
