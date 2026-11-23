import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { backupObjectKeys, backupStamp, BackupManifestSchema, buildManifest } from './manifest.ts';
import type { BackupManifest } from './manifest.ts';

const HEX = 'ab'.repeat(32);

const sample: Omit<BackupManifest, 'v'> = {
  createdAt: '2027-03-05T08:00:04.000Z',
  environment: 'staging',
  objectKey: 'pg/2027/03/20270305T080004Z.dump.enc',
  plainBytes: 734_003_200,
  encryptedBytes: 734_003_744,
  encryptedSha256: HEX,
  publicKeyFingerprint: HEX,
  pgDumpVersion: 'pg_dump (PostgreSQL) 17.6',
  serverVersion: 'PostgreSQL 17.6 fixture',
  migrationHead: { hash: HEX, createdAt: 1_772_668_800_000 },
  tableEstimates: { users: 1234, 'pgboss.job': 5 },
  durationMs: 81_234,
};

describe('backupStamp', () => {
  it('the stamp is UTC whatever the process zone', async () => {
    await eachZone(() => {
      expect(backupStamp(new Date('2027-03-05T08:00:04.123Z'))).toBe('20270305T080004Z');
      expect(backupStamp(new Date('2026-12-31T23:59:59Z'))).toBe('20261231T235959Z');
    });
  });
});

describe('backupObjectKeys', () => {
  it('object keys follow the stamp', () => {
    expect(backupObjectKeys('20270305T080004Z')).toEqual({
      dumpKey: 'pg/2027/03/20270305T080004Z.dump.enc',
      manifestKey: 'pg/2027/03/20270305T080004Z.json',
    });
  });

  it('refuses a value that is not a stamp', () => {
    expect(() => backupObjectKeys('2027-03-05')).toThrow(RangeError);
  });
});

describe('buildManifest', () => {
  it("the manifest has the contract's keys in order", () => {
    expect(Object.keys(buildManifest(sample))).toEqual([
      'v',
      'createdAt',
      'environment',
      'objectKey',
      'plainBytes',
      'encryptedBytes',
      'encryptedSha256',
      'publicKeyFingerprint',
      'pgDumpVersion',
      'serverVersion',
      'migrationHead',
      'tableEstimates',
      'durationMs',
    ]);
    expect(buildManifest(sample).v).toBe(1);
  });

  it('the manifest keeps its key order when the input lists them in another order', () => {
    const reversed = Object.fromEntries(Object.entries(sample).reverse()) as typeof sample;
    expect(Object.keys(buildManifest(reversed))[1]).toBe('createdAt');
    expect(Object.keys(buildManifest(reversed)).at(-1)).toBe('durationMs');
  });

  it('an unknown key is refused', () => {
    expect(() => buildManifest({ ...sample, extra: 1 } as never)).toThrow();
  });

  it('migrationHead may be null', () => {
    const manifest = buildManifest({ ...sample, migrationHead: null });
    expect(manifest.migrationHead).toBeNull();
    expect(BackupManifestSchema.parse(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it('refuses an object key outside the dump layout', () => {
    expect(() =>
      buildManifest({ ...sample, objectKey: 'pg/2027/03/20270305T080004Z.dump' }),
    ).toThrow();
  });
});
