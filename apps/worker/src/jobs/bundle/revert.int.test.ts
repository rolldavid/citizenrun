import { insertLoadingBundle } from '@citizenrun/db/bundle';
import {
  captureLogs,
  fixtureVersion,
  getTestDb,
  insertDataBundle,
  resetStorage,
  snapshotCivic,
  writeFixtureBundle,
  zzBundle,
  zzGeometry,
} from '@citizenrun/db/testing';
import type { FixtureBundleInput, FixtureRows } from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { withCivicLock } from '../../lib/civic-lock.ts';
import { peekQueue, runJob } from '../../testing/job.ts';
import type { RunJobResult } from '../../testing/job.ts';
import { bundleLoad } from './load.ts';
import { REVERTABLE_LOADS, bundleRevert } from './revert.ts';

// J-bundle.revert: newest first, sample- bundles and old loads refused.

const TODAY = '2027-01-15';
const NOW = new Date('2027-01-15T06:00:00Z');
const LATER = new Date('2027-01-16T06:00:00Z');
const HOUR_MS = 3_600_000;
const ADMIN_ID = newId();

function version(minute: number): string {
  return fixtureVersion(`2027-01-15T06:${String(minute).padStart(2, '0')}:00Z`, 'full');
}

function input(minute: number, files: FixtureRows): FixtureBundleInput {
  return { version: version(minute), files: structuredClone(files), geometry: zzGeometry() };
}

async function loadThroughJob(bundle: FixtureBundleInput, at: Date): Promise<string> {
  await writeFixtureBundle(bundle);
  const bundleId = await getTestDb().transaction((tx) =>
    insertLoadingBundle(tx, { version: bundle.version, kind: 'full' }),
  );
  if (bundleId === null) {
    throw new Error('A bundle of this version already exists.');
  }
  const result = await runJob(bundleLoad, { bundleId, mode: 'new' }, { clock: new FakeClock(at) });
  expect(result.outcome).toBe('completed');
  expect(await statusOf(bundleId)).toBe('loaded');
  return bundleId;
}

function revert(bundleId: string): Promise<RunJobResult> {
  return runJob(bundleRevert, { bundleId, adminId: ADMIN_ID }, { clock: new FakeClock(LATER) });
}

async function statusOf(bundleId: string): Promise<string> {
  const [found] = await getTestDb().execute<{ status: string }>(
    sql`select status from data_bundles where id = ${bundleId}::uuid`,
    'objects',
  );
  return found?.status ?? 'missing';
}

async function count(table: string, where = sql``): Promise<number> {
  const [found] = await getTestDb().execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} ${where}`,
    'objects',
  );
  return found?.n ?? -1;
}

async function scoreAllJobs(): Promise<unknown[]> {
  return (await peekQueue('score.issues'))
    .map((job) => job.data)
    .filter(
      (data) =>
        typeof data === 'object' && data !== null && 'scope' in data && data.scope === 'all',
    );
}

/** Eight loaded rows with no changes, oldest first, an hour apart. */
async function eightLoads(): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const bundle = await insertDataBundle(getTestDb(), {
      version: version(index),
      status: 'loaded',
      loadedAt: new Date(NOW.getTime() + index * HOUR_MS),
    });
    ids.push(bundle.id);
  }
  return ids;
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-bundle.revert', () => {
  it('reverting the first of two loads reverts both', async () => {
    const files = zzBundle({ today: TODAY });
    const first = await loadThroughJob(input(0, files), NOW);
    // The second load is built on the first: one office retitled.
    const next = structuredClone(files);
    const office = next.offices?.[0];
    if (office === undefined) {
      throw new Error('No office.');
    }
    office.title = 'Fixture Retitled Seat';
    const second = await loadThroughJob(input(1, next), LATER);

    const result = await revert(first);
    expect(result.outcome).toBe('completed');
    expect(await statusOf(first)).toBe('reverted');
    expect(await statusOf(second)).toBe('reverted');
    // Civic rows are retired, never deleted; every other row the loads inserted is gone.
    for (const table of ['jurisdictions', 'districts', 'offices', 'elections', 'people']) {
      expect(await count(table, sql`where retired_at is null`), table).toBe(0);
    }
    for (const table of ['office_powers', 'filing_tracks', 'officeholders', 'person_aliases']) {
      expect(await count(table), table).toBe(0);
    }
    expect(await scoreAllJobs()).toEqual([{ scope: 'all' }]);
    const reverted = captureLogs()
      .lines.filter((line) => line.parsed.event === 'bundle.reverted')
      .map((line) => line.parsed);
    expect(reverted.map((line) => [line.bundleId, line.count])).toEqual([[first, 2]]);
    expect(captureLogs().lines.some((line) => line.raw.includes(ADMIN_ID))).toBe(false);
  });

  it('an eighth-newest bundle is not revertable', async () => {
    const ids = await eightLoads();
    const before = await snapshotCivic(getTestDb());
    const oldest = ids[0] ?? '';
    const result = await revert(oldest);
    expect(result.outcome).toBe('permanent');
    for (const id of ids) {
      expect(await statusOf(id)).toBe('loaded');
    }
    expect(await snapshotCivic(getTestDb())).toEqual(before);
    expect(await scoreAllJobs()).toEqual([]);

    // The seventh-newest is among the REVERTABLE_LOADS: it and the six after it are reverted.
    expect(REVERTABLE_LOADS).toBe(7);
    expect((await revert(ids[1] ?? '')).outcome).toBe('completed');
    expect(await statusOf(oldest)).toBe('loaded');
    for (const id of ids.slice(1)) {
      expect(await statusOf(id)).toBe('reverted');
    }
  });

  it('a sample bundle is not revertable', async () => {
    const sample = await insertDataBundle(getTestDb(), {
      version: 'sample-20270101T000000Z-full',
      status: 'loaded',
      loadedAt: NOW,
    });
    const result = await revert(sample.id);
    expect(result.outcome).toBe('permanent');
    expect(await statusOf(sample.id)).toBe('loaded');
    expect(await scoreAllJobs()).toEqual([]);
  });

  it('a bundle that is not loaded, or unknown, is not revertable', async () => {
    const held = await insertDataBundle(getTestDb(), {
      version: version(1),
      status: 'held',
      loadedAt: null,
    });
    expect((await revert(held.id)).outcome).toBe('permanent');
    expect((await revert(newId())).outcome).toBe('permanent');
    expect(await statusOf(held.id)).toBe('held');
  });

  it('is idempotent', async () => {
    const files = zzBundle({ today: TODAY, offices: 2 });
    const bundleId = await loadThroughJob(input(0, files), NOW);
    expect((await revert(bundleId)).outcome).toBe('completed');
    const before = await snapshotCivic(getTestDb());
    const again = await revert(bundleId);
    expect(again.outcome).toBe('completed');
    expect(await statusOf(bundleId)).toBe('reverted');
    expect(await snapshotCivic(getTestDb())).toEqual(before);
    expect(await scoreAllJobs()).toHaveLength(1);
    expect(
      captureLogs().lines.filter((line) => line.parsed.event === 'bundle.revert.skipped'),
    ).toHaveLength(1);
  });

  it('a busy lock re-sends the job', async () => {
    const bundle = await insertDataBundle(getTestDb(), {
      version: version(1),
      status: 'loaded',
      loadedAt: NOW,
    });
    const held = await withCivicLock(getTestDb(), () => revert(bundle.id));
    expect(held.ran).toBe(true);
    expect(await statusOf(bundle.id)).toBe('loaded');
    const jobs = await peekQueue('bundle.revert');
    expect(jobs.map((job) => ({ data: job.data, singletonKey: job.singletonKey }))).toEqual([
      { data: { bundleId: bundle.id, adminId: ADMIN_ID }, singletonKey: null },
    ]);
    expect(jobs[0]?.startAfter.getTime() ?? 0).toBeGreaterThan(Date.now() + 100_000);
    expect(
      captureLogs().lines.filter((line) => line.parsed.event === 'civic_lock.busy'),
    ).toHaveLength(1);
    expect(await scoreAllJobs()).toEqual([]);
  });
});
