import { describe, expect, it } from 'vitest';
import { countDumpStamps, pruneDumps, pruneReplay } from './prune.ts';
import { createFakeS3 } from './testing/fake-s3.ts';
import type { FakeS3 } from './testing/fake-s3.ts';

const BUCKET = 'fixture-backups';

function put(fake: FakeS3, key: string): void {
  fake.objects.set(key, { body: Buffer.from('fixture'), lastModified: new Date(0) });
}

// The stamp of the n-th minute after 2027-01-01T00:00:00Z.
function stampAt(minute: number): string {
  const iso = new Date(Date.UTC(2027, 0, 1) + minute * 60_000).toISOString();
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function keysOf(stamp: string): [string, string] {
  const base = `pg/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp}`;
  return [`${base}.dump.enc`, `${base}.json`];
}

function seedStamps(fake: FakeS3, count: number): string[] {
  const stamps: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const stamp = stampAt(index * 1440);
    stamps.push(stamp);
    for (const key of keysOf(stamp)) {
      put(fake, key);
    }
  }
  return stamps;
}

describe('pruneDumps', () => {
  it('15 stamps keep 14', async () => {
    const fake = createFakeS3();
    const stamps = seedStamps(fake, 15);
    const oldest = stamps[0] ?? '';

    expect(await pruneDumps(fake.client, BUCKET, 14)).toEqual([oldest]);
    for (const key of keysOf(oldest)) {
      expect(fake.objects.has(key)).toBe(false);
    }
    expect(fake.objects.size).toBe(28);
    expect(await countDumpStamps(fake.client, BUCKET)).toBe(14);
    expect(fake.calls.filter((name) => name === 'DeleteObjectCommand')).toHaveLength(2);
  });

  it('deletes nothing when there are no more stamps than keep', async () => {
    const fake = createFakeS3();
    seedStamps(fake, 14);
    expect(await pruneDumps(fake.client, BUCKET, 14)).toEqual([]);
    expect(fake.objects.size).toBe(28);
  });

  it('keys that do not match the dump pattern are never deleted', async () => {
    const fake = createFakeS3();
    seedStamps(fake, 3);
    put(fake, 'pg/README.txt');
    put(fake, 'pg/2027/03/notastamp.dump.enc');

    const deleted = await pruneDumps(fake.client, BUCKET, 1);

    expect(deleted).toHaveLength(2);
    expect(fake.objects.has('pg/README.txt')).toBe(true);
    expect(fake.objects.has('pg/2027/03/notastamp.dump.enc')).toBe(true);
    expect(await countDumpStamps(fake.client, BUCKET)).toBe(1);
  });

  it('a stamp with only its manifest is pruned as a stamp', async () => {
    const fake = createFakeS3();
    const oldest = stampAt(0);
    put(fake, keysOf(oldest)[1]);
    const newer = seedStamps(fake, 15).slice(1);
    expect(newer).toHaveLength(14);

    expect(await pruneDumps(fake.client, BUCKET, 14)).toEqual([oldest]);
    expect(fake.objects.has(keysOf(oldest)[1])).toBe(false);
  });

  it('keep below 1 deletes nothing', async () => {
    const fake = createFakeS3();
    seedStamps(fake, 3);
    await expect(pruneDumps(fake.client, BUCKET, 0)).rejects.toBeInstanceOf(RangeError);
    expect(fake.calls).not.toContain('DeleteObjectCommand');
    expect(fake.calls).toHaveLength(0);
    expect(fake.objects.size).toBe(6);
  });

  it('lists past the first page', async () => {
    const fake = createFakeS3();
    const stamps = seedStamps(fake, 1200);

    const deleted = await pruneDumps(fake.client, BUCKET, 14);

    expect(deleted).toHaveLength(1186);
    expect(deleted).toEqual(stamps.slice(0, 1186));
    expect(fake.calls.filter((name) => name === 'DeleteObjectCommand')).toHaveLength(2372);
    expect(fake.calls.filter((name) => name === 'ListObjectsV2Command')).toHaveLength(3);
    expect(fake.objects.size).toBe(28);
  });
});

describe('pruneReplay', () => {
  const now = new Date('2027-03-05T12:00:00Z');

  it('replay entries of 36 days are deleted and of 34 days kept', async () => {
    const fake = createFakeS3();
    put(fake, 'replay/deletions/2027-01-28/a.json');
    put(fake, 'replay/deletions/2027-01-30/b.json');

    expect(await pruneReplay(fake.client, BUCKET, now, 35)).toBe(1);
    expect(fake.objects.has('replay/deletions/2027-01-28/a.json')).toBe(false);
    expect(fake.objects.has('replay/deletions/2027-01-30/b.json')).toBe(true);
  });

  it('an entry exactly 35 days old is kept', async () => {
    const fake = createFakeS3();
    put(fake, 'replay/moderation/2027-01-29/c.json');
    expect(await pruneReplay(fake.client, BUCKET, now, 35)).toBe(0);
    expect(fake.objects.has('replay/moderation/2027-01-29/c.json')).toBe(true);
  });

  it('the cutoff follows the UTC date of now, not its time', async () => {
    const fake = createFakeS3();
    put(fake, 'replay/deletions/2027-01-29/d.json');
    const lateNow = new Date('2027-03-05T23:59:59Z');
    expect(await pruneReplay(fake.client, BUCKET, lateNow, 35)).toBe(0);
    // One second later the UTC date is 2027-03-06, and the entry is 36 days old.
    const nextDay = new Date('2027-03-06T00:00:00Z');
    expect(await pruneReplay(fake.client, BUCKET, nextDay, 35)).toBe(1);
  });

  it('pruneReplay touches nothing outside replay/', async () => {
    const fake = createFakeS3();
    const stamps = seedStamps(fake, 2);
    put(fake, 'replay/README');
    put(fake, 'replay/deletions/2026-01-01/not-json.txt');
    put(fake, 'other/replay/deletions/2026-01-01/e.json');

    expect(await pruneReplay(fake.client, BUCKET, now, 35)).toBe(0);
    for (const stamp of stamps) {
      for (const key of keysOf(stamp)) {
        expect(fake.objects.has(key)).toBe(true);
      }
    }
    expect(fake.objects.has('replay/README')).toBe(true);
    expect(fake.objects.has('replay/deletions/2026-01-01/not-json.txt')).toBe(true);
    expect(fake.objects.has('other/replay/deletions/2026-01-01/e.json')).toBe(true);
  });
});
