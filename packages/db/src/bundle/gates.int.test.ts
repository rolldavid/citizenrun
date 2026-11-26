import { createHash } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { officePowers } from '../schema/civic.ts';
import { dataBundles } from '../schema/bundles.ts';
import { users } from '../schema/accounts.ts';
import { powers } from '../schema/reference.ts';
import {
  GATE_FAULTS,
  fixturePhotoRecord,
  fixtureVersion,
  getTestDb,
  insertDataBundle,
  insertDistrict,
  insertJurisdiction,
  insertOffice,
  insertUser,
  listTestKeys,
  makeOfficePower,
  putTestObject,
  resetStorage,
  setUserDistricts,
  snapshotCivic,
  testDataBucketClient,
  testMediaStore,
  writeFixtureBundle,
  zzBundle,
  zzGeometry,
  zzPhotoJpeg,
} from '../testing/index.ts';
import type { FixtureBundleInput, GateFault } from '../testing/index.ts';
import { createMediaAssetWriter } from './assets.ts';
import { GATE_ORDER } from './gates.ts';
import { prepareLoad } from './prepare.ts';
import type { PrepareOutcome } from './prepare.ts';
import { bucketReader } from './reader.ts';
import { clearStaging } from './stage.ts';
import { BundleStatsSchema } from './stats.ts';
import type { BundleStats } from './stats.ts';

// One case per gate of PIPE-loader-gates. Every rejection leaves every civic table, users,
// bundle_changes, the media bucket and both staging tables as they were (CTL-30, D-504).

const TODAY = '2027-01-15';
const VERSION = fixtureVersion('2027-01-15T06:00:00Z', 'full');

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fault(label: string): GateFault {
  const found = GATE_FAULTS.find((candidate) => candidate.label === label);
  if (found === undefined) {
    throw new Error(`No fault ${label}.`);
  }
  return found;
}

/** A valid ZZ bundle with one photo. */
async function baseInput(version = VERSION): Promise<FixtureBundleInput> {
  const photo = await zzPhotoJpeg();
  return {
    version,
    files: zzBundle({ today: TODAY, photoSha: sha256(photo) }),
    geometry: zzGeometry(),
    assets: [{ kind: 'photo', bytes: photo }],
  };
}

function rows(
  input: FixtureBundleInput,
  file: keyof FixtureBundleInput['files'],
): Record<string, unknown>[] {
  const found = input.files[file];
  if (found === undefined) {
    throw new Error(`No ${file} rows.`);
  }
  return found;
}

function row(
  input: FixtureBundleInput,
  file: keyof FixtureBundleInput['files'],
  index = 0,
): Record<string, unknown> {
  const found = rows(input, file)[index];
  if (found === undefined) {
    throw new Error(`No ${file} row ${String(index)}.`);
  }
  return found;
}

async function prepare(
  input: FixtureBundleInput,
  after?: (manifestKey: string) => Promise<void>,
): Promise<{
  outcome: PrepareOutcome;
  bundleId: string;
}> {
  const db = getTestDb();
  const { manifestKey } = await writeFixtureBundle(input);
  await after?.(manifestKey);
  const bundle = await insertDataBundle(db, {
    status: 'loading',
    loadedAt: null,
    version: input.version,
  });
  const outcome = await prepareLoad(
    db,
    bucketReader(testDataBucketClient(), manifestKey),
    'manifest.json',
    {
      bundleId: bundle.id,
      media: createMediaAssetWriter(testMediaStore()),
    },
  );
  return { outcome, bundleId: bundle.id };
}

async function stagingCount(): Promise<number> {
  const [found] = await getTestDb().execute<{ n: number }>(
    sql`select (select count(*) from staging.bundle_rows)::int + (select count(*) from staging.district_geometry)::int as n`,
    'objects',
  );
  return found?.n ?? -1;
}

/** Prepares the input and asserts it is rejected at `gate` alone with nothing written; returns the stats. */
async function expectRejected(
  input: FixtureBundleInput,
  gate: string,
  after?: (manifestKey: string) => Promise<void>,
): Promise<BundleStats> {
  const db = getTestDb();
  const before = await snapshotCivic(db);
  const { outcome, bundleId } = await prepare(input, after);
  expect(outcome.ok).toBe(false);
  const [stored] = await db.select().from(dataBundles).where(eq(dataBundles.id, bundleId));
  expect(stored?.status).toBe('rejected');
  const stats = BundleStatsSchema.parse(stored?.stats);
  const failed = stats.gates.filter((result) => !result.passed);
  expect(failed.map((result) => result.name)).toEqual([gate]);
  expect(failed[0]?.detail).not.toBeNull();
  expect(await snapshotCivic(db)).toEqual(before);
  expect(await listTestKeys('media', 'civic/')).toEqual([]);
  expect(await stagingCount()).toBe(0);
  if (!outcome.ok) {
    expect(outcome.stats).toEqual(stats);
  }
  return stats;
}

function failedDetail(stats: BundleStats): string | null {
  return stats.gates.find((result) => !result.passed)?.detail ?? null;
}

/** 1,000 live office_powers rows on 25 factory offices of one jurisdiction and one district. */
async function liveOfficePowers(): Promise<void> {
  const db = getTestDb();
  const jurisdiction = await insertJurisdiction(db);
  const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id });
  const powerIds = (
    await db.select({ id: powers.id }).from(powers).orderBy(asc(powers.id)).limit(40)
  ).map((power) => power.id);
  expect(powerIds).toHaveLength(40);
  const values = [];
  for (let index = 0; index < 25; index += 1) {
    const office = await insertOffice(db, {
      jurisdictionId: jurisdiction.id,
      districtId: district.id,
    });
    values.push(...powerIds.map((powerId) => makeOfficePower({ officeId: office.id, powerId })));
  }
  await db.insert(officePowers).values(values);
}

beforeEach(async () => {
  await resetStorage();
  await clearStaging(getTestDb());
});

describe('the gates', () => {
  it('every fault that needs no prior load rejects at its gate alone', async () => {
    const base = await baseInput();
    let index = 0;
    for (const entry of GATE_FAULTS.filter((candidate) => !candidate.needsPriorLoad)) {
      index += 1;
      await resetStorage();
      const input = entry.build({
        ...base,
        version: fixtureVersion(`2027-01-15T06:${String(index).padStart(2, '0')}:00Z`, 'full'),
      });
      await expectRejected(input, entry.gate);
    }
  });

  describe('schema_compatible', () => {
    it("rejects a revision above the loader's", async () => {
      const stats = await expectRejected(
        fault('revision').build(await baseInput()),
        'schema_compatible',
      );
      expect(failedDetail(stats)).toBe('schema_revision 1 above 0');
    });

    it('rejects a manifest listing a results file', async () => {
      const stats = await expectRejected(
        await baseInput(),
        'schema_compatible',
        async (manifestKey) => {
          const { manifest } = await writeFixtureBundle(await baseInput());
          const listed = {
            ...manifest,
            files: [
              ...manifest.files,
              {
                name: 'results',
                state: null,
                path: 'results.ndjson.gz',
                sha256: '0'.repeat(64),
                bytes: 0,
                rows: 0,
              },
            ],
          };
          await putTestObject(
            'data',
            manifestKey,
            Buffer.from(JSON.stringify(listed)),
            'application/json',
          );
        },
      );
      expect(failedDetail(stats)).toBe('file results not supported');
    });

    it('rejects a manifest of kind filings', async () => {
      const stats = await expectRejected(
        { ...(await baseInput()), manifest: { kind: 'filings' } },
        'schema_compatible',
      );
      expect(failedDetail(stats)).toBe('kind filings');
    });

    it('rejects a manifest that does not parse', async () => {
      const stats = await expectRejected(
        await baseInput(),
        'schema_compatible',
        async (manifestKey) => {
          await putTestObject('data', manifestKey, Buffer.from('{"format":'), 'application/json');
        },
      );
      expect(failedDetail(stats)).toBe('manifest invalid');
      expect(stats.schema_version).toBeNull();
    });

    it('rejects a geometry manifest of another kind', async () => {
      const input = await baseInput();
      await expectRejected(input, 'schema_compatible', async () => {
        const geometryKey = `bundles/${input.geometry?.version ?? ''}/manifest.json`;
        const { manifest } = await writeFixtureBundle({
          version: '20270101T000000Z-full',
          files: {},
        });
        await putTestObject(
          'data',
          geometryKey,
          Buffer.from(JSON.stringify({ ...manifest, version: input.geometry?.version })),
          'application/json',
        );
      });
    });
  });

  it('pipeline_checks', async () => {
    const stats = await expectRejected(
      fault('pipeline-check').build(await baseInput()),
      'pipeline_checks',
    );
    expect(failedDetail(stats)).toBe('join_rate');
  });

  describe('checksums', () => {
    it('rejects a flipped byte and leaves users and their districts untouched', async () => {
      const db = getTestDb();
      const user = await insertUser(db);
      await setUserDistricts(db, user.id);
      const stats = await expectRejected(
        fault('flipped-byte').build(await baseInput()),
        'checksums',
      );
      expect(failedDetail(stats)).toBe('offices.ndjson.gz');
      const [stored] = await db
        .select({ stale: users.districtsStaleAt })
        .from(users)
        .where(eq(users.id, user.id));
      expect(stored?.stale).toBeNull();
      const [changes] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from bundle_changes`,
        'objects',
      );
      expect(changes?.n).toBe(0);
    });

    it('rejects a missing file', async () => {
      const stats = await expectRejected(
        fault('missing-file').build(await baseInput()),
        'checksums',
      );
      expect(failedDetail(stats)).toBe('offices.ndjson.gz');
    });

    it('rejects a truncated file', async () => {
      await expectRejected(
        { ...(await baseInput()), corrupt: { file: 'people', mode: 'truncate' } },
        'checksums',
      );
    });
  });

  describe('schema_valid', () => {
    it('rejects a javascript: link', async () => {
      const stats = await expectRejected(
        fault('javascript-link').build(await baseInput()),
        'schema_valid',
      );
      expect(failedDetail(stats)).toBe('office_powers:1');
    });

    it('rejects markup in an outline', async () => {
      const stats = await expectRejected(
        fault('outline-markup').build(await baseInput()),
        'schema_valid',
      );
      expect(failedDetail(stats)).toBe('geometry/ZZ:1');
    });

    it('rejects an unknown key in one row', async () => {
      const input = await baseInput();
      row(input, 'offices', 3).fixture_extra = 1;
      const stats = await expectRejected(input, 'schema_valid');
      expect(failedDetail(stats)).toBe('offices:4');
    });
  });

  describe('shrink', () => {
    it('rejects 5.1% fewer office powers and passes 5.0% fewer', async () => {
      await liveOfficePowers();
      const large = {
        version: VERSION,
        files: zzBundle({ today: TODAY, offices: 1000, electionsPerOffice: 1 }),
        geometry: zzGeometry(),
      };
      const stats = await expectRejected(fault('shrink').build(large), 'shrink:office_powers');
      expect(failedDetail(stats)).toBe('rows 949 of live 1000');

      const fewer = structuredClone(large);
      fewer.version = fixtureVersion('2027-01-15T07:00:00Z', 'full');
      fewer.files.office_powers = rows(large, 'office_powers').slice(0, 950);
      const { outcome } = await prepare(fewer);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.prepared.gates).toContainEqual({
          name: 'shrink:office_powers',
          passed: true,
          detail: null,
        });
        expect(outcome.prepared.gates.every((result) => result.passed)).toBe(true);
      }
    });

    it('records no shrink entry for a table whose file is absent', async () => {
      const db = getTestDb();
      const jurisdiction = await insertJurisdiction(db);
      const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id });
      for (let index = 0; index < 20; index += 1) {
        await insertOffice(db, { jurisdictionId: jurisdiction.id, districtId: district.id });
      }
      const input = await baseInput();
      for (const file of [
        'offices',
        'office_powers',
        'elections',
        'filing_tracks',
        'officeholders',
      ] as const) {
        Reflect.deleteProperty(input.files, file);
      }
      const { outcome } = await prepare(input);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const names = outcome.prepared.gates.map((result) => result.name);
        expect(names).not.toContain('shrink:offices');
        expect(names).toContain('shrink:jurisdictions');
        expect(names).toContain('shrink:districts');
      }
    });
  });

  describe('references', () => {
    it('rejects an office naming no district', async () => {
      const stats = await expectRejected(
        fault('missing-district').build(await baseInput()),
        'references',
      );
      expect(failedDetail(stats)).toBe('offices:1 district_key');
    });

    it('rejects a fallback through an approximate district', async () => {
      const input = await baseInput();
      row(input, 'district_fallbacks').via_district_key = 'county_approx:census:990004';
      const stats = await expectRejected(input, 'references');
      expect(failedDetail(stats)).toBe('district_fallbacks:1 via_district_key');
    });

    it('rejects a duplicate election key', async () => {
      const input = await baseInput();
      const elections = rows(input, 'elections');
      elections.push({ ...row(input, 'elections') });
      const stats = await expectRejected(input, 'references');
      expect(failedDetail(stats)).toBe(`elections:${String(elections.length)} duplicate key`);
    });
  });

  describe('reference_ids', () => {
    it('rejects an unknown office type', async () => {
      const stats = await expectRejected(
        fault('unknown-type').build(await baseInput()),
        'reference_ids',
      );
      expect(failedDetail(stats)).toBe('offices:1 office_type_id');
    });

    it('rejects an unknown power', async () => {
      const input = await baseInput();
      row(input, 'office_powers', 1).power_id = 'fixture-unknown-power';
      const stats = await expectRejected(input, 'reference_ids');
      expect(failedDetail(stats)).toBe('office_powers:2 power_id');
    });
  });

  describe('deadlines_before_elections', () => {
    it('rejects a track closing after its election', async () => {
      const stats = await expectRejected(
        fault('late-track').build(await baseInput()),
        'deadlines_before_elections',
      );
      expect(failedDetail(stats)).toBe('filing_tracks:1');
    });

    it('rejects a petition due after its election', async () => {
      const input = await baseInput();
      const trackRow = row(input, 'filing_tracks', 1);
      const election = rows(input, 'elections').find(
        (candidate) => candidate.source_key === trackRow.election_key,
      );
      trackRow.petition_due = String(election?.election_date).replace(
        /-\d{2}$/,
        (day) => `-${String(Number(day.slice(1)) + 1).padStart(2, '0')}`,
      );
      const stats = await expectRejected(input, 'deadlines_before_elections');
      expect(failedDetail(stats)).toBe('filing_tracks:2');
    });
  });

  describe('personal_data', () => {
    it('rejects a person named with a street address', async () => {
      const stats = await expectRejected(
        fault('street-address').build(await baseInput()),
        'personal_data',
      );
      expect(failedDetail(stats)).toBe('people:1 name');
    });

    it('rejects an alias with a phone number', async () => {
      const input = await baseInput();
      row(input, 'person_aliases', 2).alias = 'Fixture 919-555-0100';
      const stats = await expectRejected(input, 'personal_data');
      expect(failedDetail(stats)).toBe('person_aliases:3 alias');
    });
  });

  describe('geometry', () => {
    it('rejects an exact district with no geometry', async () => {
      const stats = await expectRejected(fault('no-geometry').build(await baseInput()), 'geometry');
      expect(failedDetail(stats)).toBe('districts:1 a');
    });

    it('rejects an approximate district with a shape', async () => {
      const input = await baseInput();
      const shapes = input.geometry?.states.ZZ ?? [];
      const water = shapes[4];
      const alder = shapes[1];
      if (water !== undefined && alder !== undefined) {
        water.lookup_wkb = alder.lookup_wkb;
        water.display_wkb = alder.display_wkb;
      }
      const stats = await expectRejected(input, 'geometry');
      expect(failedDetail(stats)).toBe('districts:5 b');
    });

    it('rejects a geometry row whose hash differs from its district', async () => {
      const input = await baseInput();
      const cedar = input.geometry?.states.ZZ?.[3];
      if (cedar !== undefined) {
        cedar.geom_hash = sha256('fixture-other-shape');
      }
      const stats = await expectRejected(input, 'geometry');
      expect(failedDetail(stats)).toBe('districts:4 a, districts:4 c');
    });
  });

  describe('assets', () => {
    it('rejects a photo whose bytes do not match its hash', async () => {
      const stats = await expectRejected(fault('bad-asset').build(await baseInput()), 'assets');
      expect(failedDetail(stats)).toBe(`photo ${sha256('fixture-bad-asset')}`);
    });

    it('rejects a photo that is not listed', async () => {
      const input = await baseInput();
      row(input, 'people', 1).photo = fixturePhotoRecord(
        `../../assets/photos/${sha256('fixture-unlisted')}.jpg`,
        TODAY,
      );
      const stats = await expectRejected(input, 'assets');
      expect(failedDetail(stats)).toBe('people:2 asset not listed');
    });

    it('rejects a listed photo whose bytes are a PDF', async () => {
      const pdf = new TextEncoder().encode('%PDF-1.7 fixture');
      const input = await baseInput();
      input.files = zzBundle({ today: TODAY, photoSha: sha256(pdf) });
      input.assets = [{ kind: 'photo', bytes: pdf }];
      const stats = await expectRejected(input, 'assets');
      expect(failedDetail(stats)).toBe(`photo ${sha256(pdf)}`);
    });
  });

  it('a valid bundle passes every gate', async () => {
    const db = getTestDb();
    const before = await snapshotCivic(db);
    const input = await baseInput();
    const { outcome, bundleId } = await prepare(input);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const { prepared } = outcome;
    expect(prepared.gates.map((result) => result.name)).toEqual(
      GATE_ORDER.filter((name) => name !== 'shrink'),
    );
    expect(prepared.gates.every((result) => result.passed && result.detail === null)).toBe(true);
    const photoSha = sha256(input.assets?.[0]?.bytes ?? new Uint8Array());
    expect(prepared.assets).toEqual([
      {
        kind: 'photo',
        sha256: photoSha,
        path: `../../assets/photos/${photoSha}.jpg`,
        bytes: input.assets?.[0]?.bytes.length,
        mediaKey: `civic/photos/${photoSha}.jpg`,
        present: false,
      },
    ]);
    expect(prepared.geometry).toEqual({ staged: true, states: ['ZZ'] });
    expect(prepared.stats.counts.offices).toEqual({
      rows: 20,
      inserted: 0,
      updated: 0,
      retired: 0,
    });
    expect(prepared.stats.datasets).toEqual({
      'census-gus': { edition: '2022', downloaded_on: '2027-01-01' },
    });
    expect(BundleStatsSchema.safeParse(prepared.stats).success).toBe(true);
    expect(await snapshotCivic(db)).toEqual(before);
    expect(await listTestKeys('media', 'civic/')).toEqual([]);
    const [stored] = await db.select().from(dataBundles).where(eq(dataBundles.id, bundleId));
    expect(stored?.status).toBe('loading');
    expect(await stagingCount()).toBeGreaterThan(0);
  });
});
