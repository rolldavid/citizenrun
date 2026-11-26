import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOLD_FAULTS,
  fixtureJobs,
  fixtureVersion,
  getTestDb,
  listTestKeys,
  loadFixture,
  resetStorage,
  snapshotCivic,
  zzGeometry,
} from '../testing/index.ts';
import type { FixtureRows, HoldFault } from '../testing/index.ts';
import { clearStaging } from './stage.ts';
import { BundleStatsSchema } from './stats.ts';

// TEST-bundle-loader `suspicious loads are held`: each HOLD_FAULTS entry after a first load.

const TODAY = '2027-01-15';
const NOW = new Date('2027-01-15T06:00:00Z');
const LATER = new Date('2027-01-16T06:00:00Z');

function entry(label: string): HoldFault {
  const found = HOLD_FAULTS.find((candidate) => candidate.label === label);
  if (found === undefined) {
    throw new Error(`No hold fault ${label}.`);
  }
  return found;
}

function input(minute: number, files: FixtureRows) {
  return {
    version: fixtureVersion(`2027-01-15T06:${String(minute).padStart(2, '0')}:00Z`, 'full'),
    files: structuredClone(files),
    geometry: zzGeometry(),
  };
}

async function stagedRows(): Promise<number> {
  const [row] = await getTestDb().execute<{ n: number }>(
    sql`select (select count(*) from staging.bundle_rows)::int + (select count(*) from staging.district_geometry)::int as n`,
    'objects',
  );
  return row?.n ?? -1;
}

/** Loads the entry's first rows, then its second bundle; asserts held with nothing written, or loaded. */
async function check(label: string): Promise<void> {
  const db = getTestDb();
  const fault = entry(label);
  const files = fault.first(TODAY);
  const first = await loadFixture(db, input(0, files), { now: NOW });
  expect(first.result.status).toBe('loaded');
  const before = await snapshotCivic(db);
  const jobs = (await fixtureJobs(db, 'score.issues')).length;
  const keys = await listTestKeys('media', 'civic/');

  const { bundleId, result } = await loadFixture(db, fault.build(input(1, files), files), {
    now: LATER,
  });
  if (fault.hold === null) {
    expect(result.status).toBe('loaded');
    expect(result.stats.holds).toEqual([]);
    return;
  }
  expect(result.status).toBe('held');
  expect(result.stats.holds).toEqual([fault.hold]);
  const [row] = await db.execute<{ status: string; stats: unknown }>(
    sql`select status, stats from data_bundles where id = ${bundleId}::uuid`,
    'objects',
  );
  expect(row?.status).toBe('held');
  const stats = BundleStatsSchema.parse(row?.stats);
  expect(stats.holds).toEqual([fault.hold]);
  expect(stats.gates.length).toBeGreaterThan(0);
  expect(stats.gates.every((gate) => gate.passed)).toBe(true);
  expect(await snapshotCivic(db)).toEqual(before);
  expect(await stagedRows()).toBe(0);
  expect((await fixtureJobs(db, 'score.issues')).length).toBe(jobs);
  expect(await listTestKeys('media', 'civic/')).toEqual(keys);
}

beforeEach(async () => {
  await resetStorage();
  await clearStaging(getTestDb());
});

describe('the holds', () => {
  it('lists each side of each hold', () => {
    expect(HOLD_FAULTS.map((fault) => [fault.label, fault.hold])).toEqual([
      ['future-deadlines-over', 'future_deadlines'],
      ['future-deadlines-few', null],
      ['future-deadlines-share', 'future_deadlines'],
      ['future-deadlines-share-at', null],
      ['offices-over', 'offices_changed:ZZ'],
      ['offices-at', null],
    ]);
  });

  it('future_deadlines just over: 11 of 400', async () => {
    await check('future-deadlines-over');
  });

  it('future_deadlines just under: 10 of 400 is not more than 10', async () => {
    await check('future-deadlines-few');
  });

  it('future_deadlines just over: 13 of 600', async () => {
    await check('future-deadlines-share');
  });

  it('future_deadlines just under: 12 of 600 is not over 2%', async () => {
    await check('future-deadlines-share-at');
  });

  it('offices_changed just over: 5 of 20', async () => {
    await check('offices-over');
  });

  it('offices_changed just under: 4 of 20', async () => {
    await check('offices-at');
  });
});
