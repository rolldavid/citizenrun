import { civicId } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureLogs,
  fixtureVersion,
  getTestDb,
  resetStorage,
  testDataBucketClient,
  writeFixtureBundle,
  zzBundle,
  zzGeometry,
} from '../testing/index.ts';
import type { FixtureBundleInput } from '../testing/index.ts';
import { bucketReader } from './reader.ts';
import { clearStaging, emptyStageReport, stageFullFiles, stageGeometry } from './stage.ts';

const TODAY = '2027-01-15';
const BUNDLE_A = '0195a7e0-0000-7000-8000-00000000000a';
const BUNDLE_B = '0195a7e0-0000-7000-8000-00000000000b';

async function written(input: FixtureBundleInput) {
  const { manifestKey, manifest } = await writeFixtureBundle(input);
  return { manifest, reader: bucketReader(testDataBucketClient(), manifestKey) };
}

async function stagedCounts(): Promise<{ rows: number; geometry: number }> {
  const [row] = await getTestDb().execute<{ rows: number; geometry: number }>(
    sql`select (select count(*)::int from staging.bundle_rows) as rows,
               (select count(*)::int from staging.district_geometry) as geometry`,
    'objects',
  );
  return row ?? { rows: -1, geometry: -1 };
}

beforeEach(async () => {
  await resetStorage();
  await clearStaging(getTestDb());
});

describe('staging', () => {
  it('stages every line with its civic id', async () => {
    const files = zzBundle({ today: TODAY });
    const { manifest, reader } = await written({
      version: fixtureVersion('2027-01-15T06:00:00Z', 'full'),
      files,
    });
    const report = await stageFullFiles(getTestDb(), reader, manifest, BUNDLE_A);
    expect(report.checksumFailures).toEqual([]);
    expect(report.schemaFailures).toEqual([]);
    const offices = await getTestDb().execute<{ id: string; source_key: string; line: number }>(
      sql`select id, source_key, line from staging.bundle_rows where bundle_id = ${BUNDLE_A} and file = 'offices' order by line`,
      'objects',
    );
    expect(offices).toHaveLength(20);
    for (const office of offices) {
      expect(office.id).toBe(civicId('offices', office.source_key));
    }
    const powers = await getTestDb().execute<{ id: string | null }>(
      sql`select id from staging.bundle_rows where bundle_id = ${BUNDLE_A} and file = 'office_powers'`,
      'objects',
    );
    expect(powers.length).toBe(20);
    expect(powers.every((row) => row.id === null)).toBe(true);
    const counts = await getTestDb().execute<{ file: string; n: number }>(
      sql`select file, count(*)::int as n from staging.bundle_rows where bundle_id = ${BUNDLE_A} group by file`,
      'objects',
    );
    const expected = Object.fromEntries(
      Object.entries(files).map(([file, rows]) => [file, rows.length]),
    );
    expect(Object.fromEntries(counts.map((row) => [row.file, row.n]))).toEqual(expected);
    expect(report.rows).toEqual(expected);
  });

  it('inserts in batches of 1,000', async () => {
    const { manifest, reader } = await written({
      version: fixtureVersion('2027-01-15T06:00:00Z', 'full'),
      files: zzBundle({ today: TODAY, offices: 1001, electionsPerOffice: 1 }),
    });
    const db = getTestDb();
    const dialect = new PgDialect();
    const execute = vi.spyOn(db, 'execute');
    await stageFullFiles(db, reader, manifest, BUNDLE_A);
    const officeInserts = execute.mock.calls.filter(([query]) => {
      if (!(query instanceof SQL)) {
        return false;
      }
      const { sql: text, params } = dialect.sqlToQuery(query);
      return (
        text.trimStart().startsWith('insert into staging.bundle_rows') && params[1] === 'offices'
      );
    });
    expect(officeInserts).toHaveLength(2);
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from staging.bundle_rows where bundle_id = ${BUNDLE_A} and file = 'offices'`,
      'objects',
    );
    expect(row?.n).toBe(1001);
  });

  it('stages only changed geometry states', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    const first = zzGeometry({ version: '20270101T000000Z-geometry' });
    const one = await written({ version: '20270115T060000Z-full', files, geometry: first });

    // The same geometry version as the last load: nothing is staged.
    const same = await stageGeometry(
      db,
      one.reader,
      { bundleId: BUNDLE_A, manifest: one.manifest, previousGeometryVersion: first.version },
      emptyStageReport(),
    );
    expect(same).toEqual({ staged: false, states: [] });
    expect(await stagedCounts()).toEqual({ rows: 0, geometry: 0 });

    // A new version that reuses the unchanged ZZ file: only the ZIP centroids are staged.
    const reused = await written({
      version: '20270116T060000Z-full',
      files,
      geometry: {
        ...zzGeometry({ version: '20270102T000000Z-geometry' }),
        states: {},
        reuseFrom: { version: first.version, states: ['ZZ'] },
      },
    });
    const report = emptyStageReport();
    const unchanged = await stageGeometry(
      db,
      reused.reader,
      { bundleId: BUNDLE_A, manifest: reused.manifest, previousGeometryVersion: first.version },
      report,
    );
    expect(unchanged).toEqual({ staged: true, states: [] });
    expect(await stagedCounts()).toEqual({ rows: 1, geometry: 0 });
    expect(report.rows.zip_centroids).toBe(1);
    await clearStaging(db);

    // A changed ZZ file: its five districts are staged.
    const changedGeometry = zzGeometry({ version: '20270103T000000Z-geometry' });
    const firstRow = changedGeometry.states.ZZ?.[0];
    if (firstRow !== undefined) {
      firstRow.label_point = [-40.1, 30.1];
    }
    const changed = await written({
      version: '20270117T060000Z-full',
      files,
      geometry: changedGeometry,
    });
    const result = await stageGeometry(
      db,
      changed.reader,
      { bundleId: BUNDLE_A, manifest: changed.manifest, previousGeometryVersion: first.version },
      emptyStageReport(),
    );
    expect(result).toEqual({ staged: true, states: ['ZZ'] });
    expect(await stagedCounts()).toEqual({ rows: 1, geometry: 5 });
    const [shapes] = await db.execute<{ exact: number; bbox: number }>(
      sql`select count(*) filter (where lookup_geom is not null and display_geom is not null)::int as exact,
                 count(*) filter (where outline_bbox = array[0, 0, 1000, 1000]::float8[])::int as bbox
          from staging.district_geometry where bundle_id = ${BUNDLE_A}`,
      'objects',
    );
    expect(shapes).toEqual({ exact: 4, bbox: 5 });
  });

  it('a geometry row with no outline box is staged', async () => {
    const geometry = zzGeometry({ version: '20270101T000000Z-geometry' });
    const water = geometry.states.ZZ?.[4];
    if (water !== undefined) {
      water.outline_bbox = null;
    }
    const { manifest, reader } = await written({
      version: '20270115T060000Z-full',
      files: zzBundle({ today: TODAY }),
      geometry,
    });
    await stageGeometry(
      getTestDb(),
      reader,
      { bundleId: BUNDLE_A, manifest, previousGeometryVersion: null },
      emptyStageReport(),
    );
    const [row] = await getTestDb().execute<{ nulls: number; boxes: number }>(
      sql`select count(*) filter (where outline_bbox is null)::int as nulls,
                 count(*) filter (where array_length(outline_bbox, 1) = 4)::int as boxes
          from staging.district_geometry`,
      'objects',
    );
    expect(row).toEqual({ nulls: 1, boxes: 4 });
  });

  it("clearing removes every bundle's rows", async () => {
    const db = getTestDb();
    const geometry = zzGeometry();
    const { manifest, reader } = await written({
      version: '20270115T060000Z-full',
      files: zzBundle({ today: TODAY }),
      geometry,
    });
    await stageFullFiles(db, reader, manifest, BUNDLE_A);
    await stageFullFiles(db, reader, manifest, BUNDLE_B);
    await stageGeometry(
      db,
      reader,
      { bundleId: BUNDLE_A, manifest, previousGeometryVersion: null },
      emptyStageReport(),
    );
    await stageGeometry(
      db,
      reader,
      { bundleId: BUNDLE_B, manifest, previousGeometryVersion: null },
      emptyStageReport(),
    );
    const before = await stagedCounts();
    expect(before.rows).toBeGreaterThan(0);
    expect(before.geometry).toBe(10);
    await clearStaging(db);
    expect(await stagedCounts()).toEqual({ rows: 0, geometry: 0 });
  });

  it('records schema failures by line only', async () => {
    const value = marker();
    const files = zzBundle({ today: TODAY });
    const offices = files.offices ?? [];
    for (const index of [2, 5]) {
      offices[index] = { ...offices[index], title: value, fixture_extra: value };
    }
    const { manifest, reader } = await written({ version: '20270115T060000Z-full', files });
    const report = await stageFullFiles(getTestDb(), reader, manifest, BUNDLE_A);
    expect(report.schemaFailures).toEqual([
      { file: 'offices', line: 3 },
      { file: 'offices', line: 6 },
    ]);
    expect(report.rows.offices).toBe(18);
    expect(JSON.stringify(report)).not.toContain(value);
    expect(captureLogs().lines.some((line) => line.raw.includes(value))).toBe(false);
  });

  it('records personal data and duplicate keys by line and field', async () => {
    const files = zzBundle({ today: TODAY });
    const people = files.people ?? [];
    const aliases = files.person_aliases ?? [];
    const elections = files.elections ?? [];
    if (people[1] !== undefined && aliases[0] !== undefined && elections[0] !== undefined) {
      people[1].last_name = 'Fixture 12 Main Street';
      aliases[0].alias = 'Fixture 919-555-0100';
      elections.push({ ...elections[0] });
    }
    const { manifest, reader } = await written({ version: '20270115T060000Z-full', files });
    const report = await stageFullFiles(getTestDb(), reader, manifest, BUNDLE_A);
    expect(report.personalData).toEqual([
      { file: 'people', line: 2, field: 'last_name' },
      { file: 'person_aliases', line: 1, field: 'alias' },
    ]);
    expect(report.duplicateKeys).toEqual([{ file: 'elections', line: elections.length }]);
  });
});
