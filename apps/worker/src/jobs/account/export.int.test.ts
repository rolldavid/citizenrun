import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { dataExports, markAccountDeleting, users } from '@citizenrun/db';
import {
  captureLogs,
  getTestBucket,
  getTestDb,
  getTestObject,
  insertDataExport,
  resetStorage,
} from '@citizenrun/db/testing';
import { BRAND, EXPORT_FILE_TTL_MS, ExportFileSchema, newId } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { exportKey } from '@citizenrun/shared/storage';
import { FakeClock } from '@citizenrun/shared/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { testWorkerEnv } from '../../testing/env.ts';
import { insertEveryKind } from '../../testing/every-kind.ts';
import type { EveryKind } from '../../testing/every-kind.ts';
import { runJob } from '../../testing/job.ts';
import { accountExport } from './export.ts';

// TEST-account-export: the job over the deletion test's scenario, read back from the bucket.

const HOUR_MS = 60 * 60 * 1000;

function testKeys(): KeyRing {
  const env = testWorkerEnv();
  return loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS);
}

async function scenario(clock: FakeClock): Promise<EveryKind> {
  return insertEveryKind(getTestDb(), await getTestBucket('media'), testKeys(), clock.now());
}

async function queuedExport(userId: string): Promise<string> {
  return (await insertDataExport(getTestDb(), { userId, status: 'queued' })).id;
}

async function exportRow(id: string): Promise<typeof dataExports.$inferSelect | undefined> {
  const [row] = await getTestDb().select().from(dataExports).where(eq(dataExports.id, id));
  return row;
}

async function objectText(key: string): Promise<string | null> {
  const bytes = await getTestObject('media', key);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

function lines(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-account.export', () => {
  it('holds every exported section', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    const exportId = await queuedExport(kind.user.id);

    const result = await runJob(accountExport, { exportId }, { clock });

    expect(result.outcome).toBe('completed');
    const text = await objectText(exportKey(kind.user.id, exportId));
    expect(text).not.toBeNull();
    const file = ExportFileSchema.parse(JSON.parse(text ?? ''));
    expect(Object.keys(file).sort()).toEqual([
      'account',
      'consents',
      'districts',
      'follows',
      'formatVersion',
      'generatedAt',
      'issues',
      'signInMethods',
    ]);
    expect(file.account.id).toBe(kind.user.id);
    expect(file.account.email).toBe(kind.user.email);
    expect(file.account.handle).toBe(kind.user.handle);
    expect(file.account.avatarUrl).not.toBeNull();
    expect(file.account.age).not.toBeNull();
    expect(file.signInMethods.map((method) => method.provider)).toEqual([
      'email',
      'apple',
      'google',
    ]);
    expect(file.consents).toHaveLength(4);
    expect(file.issues).toHaveLength(3);
    expect(file.districts).toEqual([]);
    expect(file.follows).toEqual([]);
    expect(lines('account.exported')).toEqual([
      expect.objectContaining({ bytes: new TextEncoder().encode(text ?? '').length }),
    ]);
  });

  it('holds nothing that is not exported', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    const exportId = await queuedExport(kind.user.id);
    const [other] = await getTestDb().select().from(users).where(eq(users.id, kind.other.id));

    await runJob(accountExport, { exportId }, { clock });

    const text = (await objectText(exportKey(kind.user.id, exportId))) ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(kind.forbidden.length).toBeGreaterThan(10);
    for (const value of kind.forbidden) {
      expect(text.includes(value), 'a forbidden value').toBe(false);
    }
    expect(text).not.toContain('incoming/');
    expect(text).not.toContain(`u:${kind.user.id}:`);
    expect(text).not.toContain('calendar');
    expect(text).not.toContain('refresh');
    expect(text).not.toContain(kind.other.id);
    expect(text).not.toContain(other?.email ?? kind.other.id);
    expect(text).not.toContain(`"${other?.handle ?? kind.other.id}"`);
  });

  it('marks the export ready for a day', async () => {
    const clock = new FakeClock('2027-03-05T23:30:00.000Z');
    const kind = await scenario(new FakeClock());
    const exportId = await queuedExport(kind.user.id);

    await runJob(accountExport, { exportId }, { clock });

    const row = await exportRow(exportId);
    const key = exportKey(kind.user.id, exportId);
    expect(row?.status).toBe('ready');
    expect(row?.objectKey).toBe(key);
    expect(row?.readyAt?.toISOString()).toBe('2027-03-05T23:30:00.000Z');
    expect(row?.expiresAt?.getTime()).toBe(clock.now().getTime() + 24 * HOUR_MS);
    expect(EXPORT_FILE_TTL_MS).toBe(24 * HOUR_MS);
    const media = await getTestBucket('media');
    const head = await media.client.send(new HeadObjectCommand({ Bucket: media.bucket, Key: key }));
    expect(head.ContentType).toBe('application/json');
    expect(head.CacheControl).toBe('private, no-store');
    expect(head.ContentDisposition).toBe(
      `attachment; filename="${BRAND.slug}-export-2027-03-05.json"`,
    );
  });

  it('is idempotent', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    const exportId = await queuedExport(kind.user.id);
    await runJob(accountExport, { exportId }, { clock });
    const rowBefore = await exportRow(exportId);
    const key = exportKey(kind.user.id, exportId);
    const textBefore = await objectText(key);

    clock.advance(HOUR_MS);
    const second = await runJob(accountExport, { exportId }, { clock });

    expect(second.outcome).toBe('completed');
    expect(await exportRow(exportId)).toEqual(rowBefore);
    expect(await objectText(key)).toBe(textBefore);
    expect(lines('account.exported')).toHaveLength(1);
  });

  it('fails the export of an account being deleted', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    const exportId = await queuedExport(kind.user.id);
    await getTestDb().transaction((tx) => markAccountDeleting(tx, kind.user.id));

    const result = await runJob(accountExport, { exportId }, { clock });

    expect(result.outcome).toBe('completed');
    expect((await exportRow(exportId))?.status).toBe('failed');
    expect(await getTestObject('media', exportKey(kind.user.id, exportId))).toBeNull();
  });

  it('marks the row failed on the last attempt', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    const media = await getTestBucket('media');
    // A bucket that does not exist. The local store creates a bucket on its first write, so the
    // name is one no bucket can have: the store refuses every write to it.
    const missing = { client: media.client, bucket: `${media.bucket}_gone` };

    const early = await queuedExport(kind.user.id);
    const first = await runJob(
      accountExport,
      { exportId: early },
      {
        clock,
        media: missing,
        retryCount: 0,
      },
    );
    expect(first.outcome).toBe('failed');
    expect((await exportRow(early))?.status).toBe('queued');

    const last = await queuedExport(kind.user.id);
    const final = await runJob(
      accountExport,
      { exportId: last },
      {
        clock,
        media: missing,
        retryCount: 2,
      },
    );
    expect(final.outcome).toBe('failed');
    expect((await exportRow(last))?.status).toBe('failed');
  });

  it('does nothing for a missing row', async () => {
    const clock = new FakeClock();
    const kind = await scenario(clock);
    const exportId = await queuedExport(kind.user.id);
    const before = await getTestDb().select().from(dataExports);

    const result = await runJob(accountExport, { exportId: newId() }, { clock });

    expect(result.outcome).toBe('completed');
    expect(await getTestDb().select().from(dataExports)).toEqual(before);
    expect((await exportRow(exportId))?.status).toBe('queued');
    expect(lines('account.exported')).toHaveLength(0);
  });
});
