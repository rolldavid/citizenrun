import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ZZ_KNOWN_REFS } from '../../__fixtures__/s04/zz-known-refs.ts';
import { ZZ_STAGE1_CHECKED, zzStage1 } from '../../__fixtures__/s04/zz-units.ts';
import { encodeNdjsonGz } from '../../lib/ndjson.ts';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import { unionRow } from '../shared/geometry-rows.ts';
import { repoRoot } from '../shared/repo.ts';
import {
  CaptureRecordSchema,
  PILOT_FILES,
  PILOT_FIXTURE_MAX_BYTES,
  PilotFixtureInvalid,
  PilotFixtureTooLarge,
  PilotTemplateInvalid,
  assertPilotFixtureSize,
  electionsOf,
  loadPilotUnits,
  officesOf,
  placeholderCount,
  runPilotExpansion,
  selectPilotRows,
  tracksOf,
  writeCaptureRecord,
  writePilotFiles,
} from './harness.ts';
import type { CaptureRecord, PilotFile, PilotRun, PilotUnits } from './harness.ts';

const TODAY = '2026-11-16';
const NOW = new Date('2026-11-16T12:00:00.000Z');
const ZZ_TEMPLATE = join(repoRoot(), 'pipeline', 'templates', '__fixtures__', 'zz-template.yaml');
const TRANSFORMATIONS = [
  "Kept the rows of the counties 99001, 99003 and the state's own jurisdiction and district.",
  'Replaced lookup_wkb by display_wkb on every geometry row that has both.',
  'Kept every stage 2 office ref of the state.',
];

const folders: string[] = [];

async function tempFolder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-harness-'));
  folders.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of folders.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** The ZZ fixture rows in the capture's six files, in the order the test writes them. */
function zzFiles(): Record<PilotFile, readonly Readonly<Record<string, unknown>>[]> {
  const stage1 = zzStage1();
  return {
    jurisdictions: stage1.jurisdictions,
    districts: stage1.districts,
    district_fallbacks: stage1.fallbacks,
    geometry: stage1.geometry,
    listing: stage1.listing,
    known_refs: ZZ_KNOWN_REFS,
  };
}

/** Writes the ZZ rows and a capture.json built here into a new temporary folder. */
async function writeZzCapture(
  rowsChange: (rows: Record<PilotFile, number>) => Record<PilotFile, number> = (rows) => rows,
): Promise<string> {
  const dir = await tempFolder();
  const files = zzFiles();
  const rows = {} as Record<PilotFile, number>;
  for (const file of PILOT_FILES) {
    await writeFile(join(dir, `${file}.ndjson.gz`), encodeNdjsonGz(files[file]));
    rows[file] = files[file].length;
  }
  const capture = {
    state: 'ZZ',
    counties: ['99001', '99003'],
    captured_at: '2026-11-16T12:00:00.000Z',
    stage1_finished_at: ZZ_STAGE1_CHECKED,
    stage2_finished_at: null,
    census_gus_edition: '2026',
    rows: rowsChange(rows),
    transformations: TRANSFORMATIONS,
  };
  await writeFile(join(dir, 'capture.json'), `${JSON.stringify(capture, null, 2)}\n`);
  return dir;
}

async function zzUnits(): Promise<PilotUnits> {
  return loadPilotUnits(await writeZzCapture());
}

/** A copy of the ZZ template with `change` applied to its text, written under a temporary folder. */
async function templateCopy(change: (text: string) => string): Promise<string> {
  const text = await readFile(ZZ_TEMPLATE, 'utf8');
  const changed = change(text);
  expect(changed).not.toBe(text);
  const path = join(await tempFolder(), 'zz.yaml');
  await writeFile(path, changed);
  return path;
}

async function zzRun(templatePath = ZZ_TEMPLATE, units?: PilotUnits): Promise<PilotRun> {
  return runPilotExpansion({
    templatePath,
    rules: ZZ_RULES,
    units: units ?? (await zzUnits()),
    today: TODAY,
    now: NOW,
  });
}

const EAST_COUNTIES = "counties: ['99001', '99003']";

describe('the pilot harness', () => {
  it('capture files round-trip', async () => {
    const units = await zzUnits();
    const stage1 = zzStage1();
    expect(units.jurisdictions).toEqual(stage1.jurisdictions);
    expect(units.districts).toEqual(stage1.districts);
    expect(units.fallbacks).toEqual(stage1.fallbacks);
    expect(units.geometry).toEqual(stage1.geometry);
    expect(units.listing).toEqual(stage1.listing);
    expect(units.knownRefs).toEqual(ZZ_KNOWN_REFS);
    expect(units.capture.counties).toEqual(['99001', '99003']);
    expect(units.capture.rows.districts).toBe(stage1.districts.length);

    const offByOne = await writeZzCapture((rows) => ({ ...rows, districts: rows.districts + 1 }));
    const failure = await loadPilotUnits(offByOne).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PilotFixtureInvalid);
    expect((failure as PilotFixtureInvalid).file).toBe('districts.ndjson.gz');
    expect((failure as Error).message).toContain('districts.ndjson.gz');
  });

  it('a missing file or a bad capture record is refused', async () => {
    const missing = await writeZzCapture();
    await rm(join(missing, 'geometry.ndjson.gz'));
    await expect(loadPilotUnits(missing)).rejects.toThrow('geometry.ndjson.gz');
    const bad = await writeZzCapture((rows) => ({ ...rows, listing: -1 }));
    await expect(loadPilotUnits(bad)).rejects.toBeInstanceOf(PilotFixtureInvalid);
    await expect(loadPilotUnits(bad)).rejects.toThrow('capture.json');
  });

  it('the ZZ template runs through both stages', async () => {
    const run = await zzRun();
    const passed = (name: string) => run.expand.checks.find((c) => c.name === name)?.passed;
    expect(passed('slug_unique')).toBe(true);
    expect(passed('template_pattern')).toBe(true);

    const county = officesOf(run, 'census:990001');
    expect(county.map((o) => o.office_type_id).sort()).toEqual(['county-commission', 'sheriff']);
    expect(county.map((o) => o.source_key)).toEqual([...county.map((o) => o.source_key)].sort());
    const commission = county.find((o) => o.office_type_id === 'county-commission');
    expect(commission?.slug).toBe('zz-fixture-county-board-of-commissioners');

    // ZZ_RULES: county offices are elected in even years, on the first Tuesday in May (one primary
    // per party for a partisan office) and on the November election day; the commission's group A
    // is elected in 2026 and group B in 2028, both inside the window of 2026-11-16.
    const elections = electionsOf(run, 'zz-fixture-county-board-of-commissioners');
    expect(elections.map((e) => [e.election_date, e.kind, e.party])).toEqual([
      ['2026-05-05', 'primary', 'democratic'],
      ['2026-05-05', 'primary', 'republican'],
      ['2026-11-03', 'general', null],
      ['2028-05-02', 'primary', 'democratic'],
      ['2028-05-02', 'primary', 'republican'],
      ['2028-11-07', 'general', null],
    ]);

    // 60 days before 2 May 2028 is Friday 3 March, a business day.
    const democratic = elections.find(
      (e) => e.election_date === '2028-05-02' && e.kind === 'primary' && e.party === 'democratic',
    );
    const tracks = tracksOf(run, democratic?.source_key ?? '');
    expect(tracks.map((t) => [t.track, t.opens_on, t.closes_on])).toEqual([
      ['party_primary', '2028-02-02', '2028-03-03'],
    ]);
    const general = elections.find((e) => e.election_date === '2028-11-07');
    expect(tracksOf(run, general?.source_key ?? '').map((t) => [t.track, t.closes_on])).toEqual([
      ['independent', '2028-08-24'],
    ]);

    expect(run.deadlines.checks.find((c) => c.name === 'rules_plausible')?.passed).toBe(true);
    expect(placeholderCount(run, 'special_district')).toBe(1);
    expect(placeholderCount(run, 'county')).toBe(0);
    expect(placeholderCount(run)).toBeGreaterThanOrEqual(1);
    expect(run.template.state).toBe('ZZ');
    expect(run.template.checked_at).toBe(NOW.toISOString());
    expect(Object.values(run.template.grounded).every((mark) => mark.reason === 'refused')).toBe(
      true,
    );
  });

  it('county sets are narrowed to the captured counties', async () => {
    const units = await zzUnits();
    const oneMissing = await zzRun(
      await templateCopy((text) => text.replace(EAST_COUNTIES, "counties: ['99001', '99007']")),
      units,
    );
    const east = oneMissing.expand.geometry.find(
      (row) => row.source_key === 'county_union:ZZ:east',
    );
    const county = (geoid: string) => {
      const row = units.geometry.find((g) => g.source_key === `tiger:county:${geoid}`);
      if (row === undefined) {
        throw new Error(`the ZZ capture has no county ${geoid}`);
      }
      return row;
    };
    // The union's outline is projected, so it is compared with the union of 99001 alone.
    const alone = await unionRow('county_union:ZZ:east', [county('99001')], '99');
    const both = await unionRow('county_union:ZZ:east', [county('99001'), county('99003')], '99');
    expect(east).toBeDefined();
    expect(east?.outline_bbox).toEqual(alone.outline_bbox);
    expect(east?.outline_bbox).not.toEqual(both.outline_bbox);
    expect(east?.display_wkb).toBe(alone.display_wkb);
    expect(oneMissing.template.template.county_sets.map((set) => set.counties)).toEqual([
      ['99001'],
    ]);

    const allMissing = await zzRun(
      await templateCopy((text) => text.replace(EAST_COUNTIES, "counties: ['99007']")),
      units,
    );
    expect(allMissing.expand.districts.some((d) => d.source_key === 'county_union:ZZ:east')).toBe(
      false,
    );
    expect(allMissing.expand.officeRefs.some((r) => r.template_key === 'trial-judge-east')).toBe(
      false,
    );
    expect(oneMissing.expand.officeRefs.some((r) => r.template_key === 'trial-judge-east')).toBe(
      true,
    );
    expect(allMissing.template.template.county_sets).toEqual([]);
  });

  it('an invalid template throws with paths only', async () => {
    const path = await templateCopy((text) =>
      text.replace('power: zoning-land-use', 'power: fixture-unknown-power'),
    );
    const failure = await zzRun(path).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PilotTemplateInvalid);
    const message = (failure as Error).message;
    expect(message).toContain('powers.0.power');
    expect(message).not.toContain('fixture-unknown-power');
  });

  it('the harness makes no request', async () => {
    const run = await zzRun();
    expect(run.expand.offices.length).toBeGreaterThan(0);
    const source = await readFile(join(import.meta.dirname, 'harness.ts'), 'utf8');
    const imports = source.split('\n').filter((line) => /^import |^} from /.test(line));
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((line) => line.includes('lib/fetch/'))).toEqual([]);
    expect(imports.filter((line) => line.includes('vitest'))).toEqual([]);
  });

  it('a state module resolves by its package subpath', async () => {
    // A pilot test imports its state's module this way before the module is registered.
    const states = await import('@citizenrun/rules/states/index');
    expect(states.STATE_MODULES).toBeInstanceOf(Map);
  });

  it('a folder over the limit throws', async () => {
    const dir = await tempFolder();
    await writeFile(join(dir, 'geometry.ndjson.gz'), Buffer.alloc(PILOT_FIXTURE_MAX_BYTES));
    await expect(assertPilotFixtureSize(dir)).resolves.toBe(PILOT_FIXTURE_MAX_BYTES);
    await writeFile(join(dir, 'geometry.ndjson.gz'), Buffer.alloc(PILOT_FIXTURE_MAX_BYTES + 1));
    await expect(assertPilotFixtureSize(dir)).rejects.toBeInstanceOf(PilotFixtureTooLarge);
  });
});

describe('the pilot capture', () => {
  function select(counties: readonly string[]) {
    const stage1 = zzStage1();
    const geometry = stage1.geometry.map((row) =>
      row.source_key === 'tiger:county:99003'
        ? { ...row, lookup_wkb: `${row.lookup_wkb ?? ''}00` }
        : row,
    );
    return selectPilotRows({
      state: 'ZZ',
      counties,
      jurisdictions: stage1.jurisdictions,
      districts: stage1.districts,
      fallbacks: stage1.fallbacks,
      geometry,
      listing: stage1.listing,
      knownRefs: [...ZZ_KNOWN_REFS].reverse(),
    });
  }

  it("keeps a county's units, their districts and the state's own rows", () => {
    const second = select(['99003']);
    expect(second.jurisdictions.map((j) => j.source_key)).toEqual(['census:990007', 'state:ZZ']);
    expect(second.districts.map((d) => d.source_key)).toEqual([
      'tiger:county:99003',
      'tiger:state:99',
    ]);
    expect(second.fallbacks).toEqual([]);
    expect(second.geometry.map((g) => g.source_key)).toEqual([
      'tiger:county:99003',
      'tiger:state:99',
    ]);
    // The changed lookup_wkb is replaced by the display_wkb.
    for (const row of second.geometry) {
      expect(row.lookup_wkb).toBe(row.display_wkb);
    }
    expect(second.listing.map((row) => row.pid6)).toEqual(['990007']);
    expect(second.knownRefs.map((ref) => ref.slug)).toEqual([
      'zz-state-senator-district-1',
      'zz-state-senator-district-2',
    ]);

    const first = select(['99001']);
    expect(first.jurisdictions.map((j) => j.source_key)).toEqual([
      'census:990001',
      'census:990002',
      'census:990003',
      'census:990004',
      'census:990005',
      'census:990006',
      'state:ZZ',
    ]);
    // Never the state's congressional district or a county another jurisdiction holds.
    expect(first.districts.map((d) => d.source_key)).toEqual([
      'county_approx:census:990003',
      'county_approx:census:990004',
      'county_approx:census:990006',
      'tiger:county:99001',
      'tiger:cousub:9900100500',
      'tiger:place:9900100',
      'tiger:state:99',
    ]);
    expect(first.fallbacks.map((f) => f.via_district_key)).toEqual([
      'tiger:county:99001',
      'tiger:county:99001',
      'tiger:county:99001',
    ]);
    expect(first.geometry.map((g) => g.source_key)).toEqual(
      first.districts.map((d) => d.source_key),
    );
  });

  it('writes a folder that loads back, with capture.json in the schema order', async () => {
    const dir = await tempFolder();
    const rows = select(['99001', '99003']);
    const counts = await writePilotFiles(dir, rows);
    const record: CaptureRecord = {
      state: 'ZZ',
      counties: ['99001', '99003'],
      captured_at: NOW.toISOString(),
      stage1_finished_at: ZZ_STAGE1_CHECKED,
      stage2_finished_at: null,
      census_gus_edition: '2026',
      rows: counts,
      transformations: TRANSFORMATIONS,
    };
    await writeCaptureRecord(dir, record);
    const text = await readFile(join(dir, 'capture.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n')[1]).toBe('  "state": "ZZ",');
    expect(Object.keys(JSON.parse(text) as object)).toEqual(Object.keys(CaptureRecordSchema.shape));
    const loaded = await loadPilotUnits(dir);
    expect(loaded.capture).toEqual(record);
    expect(loaded.districts).toEqual(rows.districts);
    expect(loaded.knownRefs).toEqual(rows.knownRefs);
    const again = await tempFolder();
    await writePilotFiles(again, rows);
    for (const file of PILOT_FILES) {
      expect(await readFile(join(again, `${file}.ndjson.gz`))).toEqual(
        await readFile(join(dir, `${file}.ndjson.gz`)),
      );
    }
  });
});
