import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOLD_FAULTS,
  fixtureEnqueue,
  fixtureVersion,
  getTestDb,
  loadFixture,
  resetStorage,
  snapshotCivic,
  testDataBucketClient,
  testMediaStore,
  zzBundle,
  zzGeometry,
} from '../testing/index.ts';
import type { FixtureRows } from '../testing/index.ts';
import { createMediaAssetWriter } from './assets.ts';
import {
  KEY_COLUMNS,
  LOADER_COLUMNS,
  RETIRING_TABLES,
  beforeObject,
  rowKeyObject,
} from './columns.ts';
import type { LoaderTable } from './columns.ts';
import { loadBundle, revertBundle } from './load.ts';
import { bucketReader } from './reader.ts';
import { clearStaging } from './stage.ts';

// revertBundle (PIPE-loader-hold-revert, J-bundle.revert).

const TODAY = '2027-01-15';
const NOW = new Date('2027-01-15T06:00:00Z');
const LATER = new Date('2027-01-16T06:00:00Z');
const REVERTED_AT = new Date('2027-01-17T06:00:00Z');

type Snapshot = Record<LoaderTable, Map<string, unknown>>;

function input(minute: number, files: FixtureRows) {
  return {
    version: fixtureVersion(`2027-01-15T06:${String(minute).padStart(2, '0')}:00Z`, 'full'),
    files: structuredClone(files),
    geometry: zzGeometry(),
  };
}

function rowsOf(files: FixtureRows, file: keyof FixtureRows): Record<string, unknown>[] {
  const found = files[file];
  if (found === undefined) {
    throw new Error(`No ${file} rows.`);
  }
  return found;
}

function find(
  files: FixtureRows,
  file: keyof FixtureRows,
  test: (row: Record<string, unknown>) => boolean,
) {
  const found = rowsOf(files, file).find(test);
  if (found === undefined) {
    throw new Error(`No such ${file} row.`);
  }
  return found;
}

/** Every loader table's rows by row key, holding the LOADER columns only (updated_at is not one). */
async function loaderSnapshot(): Promise<Snapshot> {
  const snapshot = {} as Snapshot;
  for (const table of Object.keys(LOADER_COLUMNS) as LoaderTable[]) {
    const rows = await getTestDb().execute<{ key: Record<string, string>; columns: unknown }>(
      sql`select ${rowKeyObject(table, 't')} as key, ${beforeObject(table, 't')} as columns
          from ${sql.identifier(table)} t`,
      'objects',
    );
    snapshot[table] = new Map(
      rows.map((row) => [KEY_COLUMNS[table].map((key) => row.key[key]).join('|'), row.columns]),
    );
  }
  return snapshot;
}

async function headlines(): Promise<unknown[]> {
  return getTestDb().execute(
    sql`select id, filing_opens::text, filing_deadline::text, filing_deadline_time::text, petition_due::text, deadline_basis
        from elections order by id`,
    'objects',
  );
}

/** The rows after the revert equal those of `before`; a row `before` lacks is a retired row of a retiring table. */
function expectRestored(before: Snapshot, after: Snapshot): string[] {
  const extra: string[] = [];
  for (const table of Object.keys(LOADER_COLUMNS) as LoaderTable[]) {
    for (const [key, columns] of before[table]) {
      expect(after[table].get(key), `${table} ${key}`).toEqual(columns);
    }
    for (const [key, columns] of after[table]) {
      if (!before[table].has(key)) {
        expect(RETIRING_TABLES, `${table} ${key} was not removed`).toContain(table);
        expect(
          (columns as { retired_at: string | null }).retired_at,
          `${table} ${key}`,
        ).not.toBeNull();
        extra.push(`${table} ${key}`);
      }
    }
  }
  return extra;
}

async function status(bundleId: string): Promise<string | undefined> {
  const [row] = await getTestDb().execute<{ status: string }>(
    sql`select status from data_bundles where id = ${bundleId}::uuid`,
    'objects',
  );
  return row?.status;
}

beforeEach(async () => {
  await resetStorage();
  await clearStaging(getTestDb());
});

describe('revertBundle', () => {
  it('revert restores the earlier values', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const afterA = await loaderSnapshot();
    const headlinesA = await headlines();

    const b = structuredClone(files);
    find(b, 'offices', (row) => row.slug === 'zz-fixture-seat-001').title = 'Fixture Renamed Seat';
    const added = { ...find(b, 'offices', (row) => row.slug === 'zz-fixture-seat-001') };
    Object.assign(added, {
      source_key: 'zz-fixture-seat-021',
      slug: 'zz-fixture-seat-021',
      title: 'Fixture Seat 021',
    });
    rowsOf(b, 'offices').push(added);
    // Office 2 keeps its general election and loses that election's only track.
    const general = find(
      b,
      'elections',
      (row) => row.office_key === 'zz-fixture-seat-002' && row.kind === 'general',
    );
    b.filing_tracks = rowsOf(b, 'filing_tracks').filter(
      (row) => row.election_key !== general.source_key,
    );
    // Office 3 loses its primary election, and with it the election's track.
    const primary = find(
      b,
      'elections',
      (row) => row.office_key === 'zz-fixture-seat-003' && row.kind === 'primary',
    );
    b.elections = rowsOf(b, 'elections').filter((row) => row.source_key !== primary.source_key);
    b.filing_tracks = rowsOf(b, 'filing_tracks').filter(
      (row) => row.election_key !== primary.source_key,
    );
    find(b, 'people', (row) => row.slug === 'fixture-holder-004').name = 'Fixture Renamed Holder';
    const loadB = await loadFixture(db, input(1, b), { now: LATER });
    expect(loadB.result.status).toBe('loaded');
    expect(await loaderSnapshot()).not.toEqual(afterA);

    await revertBundle(db, loadB.bundleId, REVERTED_AT);
    const extra = expectRestored(afterA, await loaderSnapshot());
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatch(/^offices /);
    expect(await headlines()).toEqual(headlinesA);
    expect(await status(loadB.bundleId)).toBe('reverted');
    const [office] = await db.execute<{ retired: boolean; title: string }>(
      sql`select retired_at is not null as retired, title from offices where slug = 'zz-fixture-seat-021'`,
      'objects',
    );
    expect(office).toEqual({ retired: true, title: 'Fixture Seat 021' });
    const [renamed] = await db.execute<{ hits: number }>(
      sql`select count(*)::int as hits from offices where search @@ to_tsquery('english', 'renamed')`,
      'objects',
    );
    expect(renamed?.hits).toBe(0);
  });

  it('revert is idempotent', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const b = structuredClone(files);
    find(b, 'offices', (row) => row.slug === 'zz-fixture-seat-001').title = 'Fixture Renamed Seat';
    const loadB = await loadFixture(db, input(1, b), { now: LATER });
    await revertBundle(db, loadB.bundleId, REVERTED_AT);
    const once = await snapshotCivic(db);
    await revertBundle(db, loadB.bundleId, new Date('2027-01-18T06:00:00Z'));
    expect(await snapshotCivic(db)).toEqual(once);
    expect(await status(loadB.bundleId)).toBe('reverted');
  });

  it('revert of an insert deletes on child tables', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const [power] = await db.execute<{ id: string }>(
      sql`select id from powers where id <> 'zoning-land-use' order by id limit 1`,
      'objects',
    );
    if (power === undefined) {
      throw new Error('No second power.');
    }
    const b = structuredClone(files);
    rowsOf(b, 'office_powers').push({
      ...find(b, 'office_powers', (row) => row.office_key === 'zz-fixture-seat-001'),
      source_key: `zz-fixture-seat-001|${power.id}`,
      power_id: power.id,
    });
    const loadB = await loadFixture(db, input(1, b), { now: LATER });
    expect(loadB.result.status).toBe('loaded');
    const powersOf = sql`select p.power_id from office_powers p join offices o on o.id = p.office_id
      where o.slug = 'zz-fixture-seat-001' order by p.power_id`;
    expect((await db.execute(powersOf, 'objects')).length).toBe(2);
    await revertBundle(db, loadB.bundleId, REVERTED_AT);
    expect(await db.execute(powersOf, 'objects')).toEqual([{ power_id: 'zoning-land-use' }]);
  });

  it('held then approved then reverted', async () => {
    const db = getTestDb();
    const fault = HOLD_FAULTS.find((candidate) => candidate.label === 'offices-over');
    if (fault === undefined) {
      throw new Error('No offices-over entry.');
    }
    const files = fault.first(TODAY);
    await loadFixture(db, input(0, files), { now: NOW });
    const afterA = await loaderSnapshot();
    const held = await loadFixture(db, fault.build(input(1, files), files), { now: LATER });
    expect(held.result.status).toBe('held');

    // The admin's approval sets the row to loading and the job loads it with approved: true.
    await db.execute(
      sql`update data_bundles set status = 'loading' where id = ${held.bundleId}::uuid`,
    );
    const approved = await loadBundle(
      db,
      bucketReader(testDataBucketClient(), held.manifestKey),
      'manifest.json',
      {
        bundleId: held.bundleId,
        approved: true,
        now: LATER,
        enqueue: await fixtureEnqueue(),
        media: createMediaAssetWriter(testMediaStore()),
      },
    );
    expect(approved.status).toBe('loaded');
    const [retitled] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from offices where title like 'Fixture Retitled Seat %'`,
      'objects',
    );
    expect(retitled?.n).toBe(5);

    await revertBundle(db, held.bundleId, REVERTED_AT);
    expect(expectRestored(afterA, await loaderSnapshot())).toEqual([]);
    expect(await status(held.bundleId)).toBe('reverted');
  });
});
