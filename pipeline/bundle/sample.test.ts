import { createHash } from 'node:crypto';
import { BundleManifestSchema } from '@citizenrun/shared';
import type { BGeometry, BZipCentroid, BundleManifest } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { geomHash, multiPolygonToWkb, toHex } from '../lib/wkb.ts';
import type { ParsedListingRow } from '../sources/census-gus.ts';
import { emptyRows } from './assemble.ts';
import type { AssembledRows } from './assemble.ts';
import { integrityCheck } from './checks.ts';
import {
  SAMPLE_MAX_PHOTOS,
  pointInMultiPolygon,
  sampleGeometryRows,
  selectSample,
} from './sample.ts';
import type { MultiPolygonCoords, SampleSource } from './sample.ts';
import {
  district,
  election,
  holder,
  jurisdiction,
  office,
  person,
  power,
  track,
} from './testing/rows.ts';

// selectSample on an in-memory ZZ source: three counties (99001 and 99003 named, 99005 far), a
// co-op serving 99001 and 99005, two congressional districts, and 25 people with photos.

type Square = readonly [number, number, number];

function square([x, y, size]: Square): MultiPolygonCoords {
  return [
    [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  ];
}

function hex(coords: MultiPolygonCoords): string {
  return toHex(multiPolygonToWkb(coords));
}

function hash(coords: MultiPolygonCoords): string {
  return geomHash(multiPolygonToWkb(coords));
}

/** An exact district with its geometry: lookup is the square, display the square shrunk a little. */
function exact(
  key: string,
  jurisdictionKey: string,
  at: Square,
  level: 'county' | 'state' | 'federal' | 'local' = 'county',
): { row: ReturnType<typeof district>; shape: BGeometry } {
  const lookup = square(at);
  const display = square([at[0] + 0.01, at[1] + 0.01, at[2] - 0.02]);
  return {
    row: district(key, { jurisdiction_key: jurisdictionKey, level, geom_hash: hash(lookup) }),
    shape: {
      source_key: key,
      lookup_wkb: hex(lookup),
      display_wkb: hex(display),
      label_point: [at[0] + at[2] / 2, at[1] + at[2] / 2],
      outline_svg: 'M0 0L10 0L10 10Z',
      outline_bbox: [at[0], at[1], at[0] + at[2], at[1] + at[2]],
      geom_hash: hash(lookup),
    },
  };
}

function approximate(
  key: string,
  jurisdictionKey: string,
): {
  row: ReturnType<typeof district>;
  shape: BGeometry;
} {
  const fake = 'b'.repeat(64);
  return {
    row: district(key, {
      jurisdiction_key: jurisdictionKey,
      geometry_quality: 'county_approx',
      level: 'special',
      geom_hash: fake,
    }),
    shape: {
      source_key: key,
      lookup_wkb: null,
      display_wkb: null,
      label_point: null,
      outline_svg: null,
      outline_bbox: null,
      geom_hash: fake,
    },
  };
}

function listingRow(pid6: string, county: string): ParsedListingRow {
  return {
    tab: 'General Purpose',
    pid6,
    unit_name: `FIXTURE UNIT ${pid6}`,
    unit_type: null,
    title: null,
    city: null,
    state: 'ZZ',
    zip: null,
    web_address: null,
    political_code_description: null,
    population: null,
    population_source_year: null,
    fips_state: '99',
    fips_county: county,
    fips_place: null,
    county_area_name: null,
    active: true,
    function_name: null,
    school_enrollment: null,
    enrollment_year: null,
    school_level_description: null,
    parent_pid6: null,
    parent_unit_name: null,
  };
}

function photoSha(n: number): string {
  return createHash('sha256')
    .update(`photo ${String(n)}`)
    .digest('hex');
}

function manifest(kind: 'full' | 'geometry'): BundleManifest {
  return BundleManifestSchema.parse({
    format: 'citizenrun-bundle',
    kind,
    version: `20261126T120000Z-${kind}`,
    schema_version: 1,
    schema_revision: 0,
    created_at: '2026-11-26T12:00:00.000Z',
    git_sha: '0'.repeat(40),
    geometry_version: kind === 'full' ? '20261126T120000Z-geometry' : null,
    tiger_vintage: kind === 'geometry' ? '2026' : null,
    states: ['ZZ'],
    files: [],
    assets: [],
    datasets: {},
    checks: [],
    filing_sources: [],
    two_source_fields: 0,
    coverage_path: null,
    attribution_path: 'ATTRIBUTION.md',
  });
}

const PEOPLE = 25;

function zzSource(): SampleSource {
  const rows: AssembledRows = emptyRows();
  const shapes: BGeometry[] = [];
  const add = (made: { row: ReturnType<typeof district>; shape: BGeometry }) => {
    rows.districts.push(made.row);
    shapes.push(made.shape);
  };
  rows.jurisdictions.push(
    jurisdiction('state:ZZ', { kind: 'state', name: 'Fixture State' }),
    jurisdiction('census:990001', { name: 'Fixture County', parent_key: 'state:ZZ' }),
    jurisdiction('census:990002', {
      kind: 'city',
      name: 'Fixture City',
      parent_key: 'census:990001',
    }),
    jurisdiction('census:990007', { name: 'Fixture Second County', parent_key: 'state:ZZ' }),
    jurisdiction('census:990009', { name: 'Fixture Far County', parent_key: 'state:ZZ' }),
    jurisdiction('census:990010', {
      kind: 'city',
      name: 'Fixture Far City',
      parent_key: 'census:990009',
    }),
    jurisdiction('coop:1001', { kind: 'coop', name: 'Fixture Co-op' }),
    jurisdiction('party:ZZ:99001:democratic', {
      kind: 'party',
      name: 'Fixture County Party',
      parent_key: 'state:ZZ',
    }),
    jurisdiction('party:ZZ:99005:democratic', {
      kind: 'party',
      name: 'Fixture Far County Party',
      parent_key: 'state:ZZ',
    }),
  );
  add(exact('tiger:state:99', 'state:ZZ', [0, 0, 20], 'state'));
  add(exact('tiger:county:99001', 'census:990001', [0, 0, 1]));
  add(exact('tiger:place:9900002', 'census:990002', [0.2, 0.2, 0.5], 'local'));
  add(exact('tiger:county:99003', 'census:990007', [2, 0, 1]));
  add(exact('tiger:county:99005', 'census:990009', [10, 10, 1]));
  add(exact('tiger:place:9900010', 'census:990010', [10.2, 10.2, 0.5], 'local'));
  add(exact('tiger:cd:9901', 'state:ZZ', [0, 0, 3], 'federal'));
  add(exact('tiger:cd:9902', 'state:ZZ', [9, 9, 3], 'federal'));
  add(approximate('county_approx:coop:1001', 'coop:1001'));
  add(approximate('county_approx:party:ZZ:99001:democratic', 'party:ZZ:99001:democratic'));
  add(approximate('county_approx:party:ZZ:99005:democratic', 'party:ZZ:99005:democratic'));
  rows.district_fallbacks.push(
    {
      source_key: 'county_approx:coop:1001|tiger:county:99001',
      district_key: 'county_approx:coop:1001',
      via_district_key: 'tiger:county:99001',
    },
    {
      source_key: 'county_approx:coop:1001|tiger:county:99005',
      district_key: 'county_approx:coop:1001',
      via_district_key: 'tiger:county:99005',
    },
    {
      source_key: 'county_approx:party:ZZ:99001:democratic|tiger:county:99001',
      district_key: 'county_approx:party:ZZ:99001:democratic',
      via_district_key: 'tiger:county:99001',
    },
    {
      source_key: 'county_approx:party:ZZ:99005:democratic|tiger:county:99005',
      district_key: 'county_approx:party:ZZ:99005:democratic',
      via_district_key: 'tiger:county:99005',
    },
  );
  const offices: [string, string, string][] = [
    ['zz-governor', 'state:ZZ', 'tiger:state:99'],
    ['zz-fixture-county-commission', 'census:990001', 'tiger:county:99001'],
    ['zz-fixture-city-council', 'census:990002', 'tiger:place:9900002'],
    ['zz-fixture-second-county-commission', 'census:990007', 'tiger:county:99003'],
    ['zz-fixture-far-county-commission', 'census:990009', 'tiger:county:99005'],
    ['zz-fixture-far-city-council', 'census:990010', 'tiger:place:9900010'],
    ['zz-fixture-co-op-board', 'coop:1001', 'county_approx:coop:1001'],
    [
      'zz-fixture-county-party-chair',
      'party:ZZ:99001:democratic',
      'county_approx:party:ZZ:99001:democratic',
    ],
    [
      'zz-fixture-far-county-party-chair',
      'party:ZZ:99005:democratic',
      'county_approx:party:ZZ:99005:democratic',
    ],
    ['zz-us-house-1', 'state:ZZ', 'tiger:cd:9901'],
    ['zz-us-house-2', 'state:ZZ', 'tiger:cd:9902'],
  ];
  for (const [slug, jurisdictionKey, districtKey] of offices) {
    rows.offices.push(
      office(slug, { jurisdiction_key: jurisdictionKey, district_key: districtKey }),
    );
    rows.office_powers.push(power(slug, 'budget'));
    const general = election(slug, '2027-11-02');
    rows.elections.push(general);
    rows.filing_tracks.push(track(general.source_key));
  }
  for (let n = 1; n <= PEOPLE; n += 1) {
    const key = `wikidata:Q${String(n)}`;
    rows.people.push(
      person(key, {
        slug: `fixture-person-${String(n).padStart(8, '0')}`,
        photo: {
          asset: `../../assets/photos/${photoSha(n)}.jpg`,
          width: 320,
          height: 400,
          source_url: 'https://example.test/zz/photo',
          author: 'Fixture Author',
          license: 'CC0-1.0',
          license_url: 'https://example.test/zz/license',
          credit_text: 'Fixture credit',
          modified: false,
          retrieved_at: '2026-11-01T00:00:00.000Z',
        },
      }),
    );
    rows.person_aliases.push({
      source_key: `${key}|Fixture ${String(n)}`,
      person_key: key,
      alias: `Fixture ${String(n)}`,
    });
    rows.officeholders.push(holder('zz-fixture-county-commission', key));
  }
  rows.people.push(person('wikidata:Q900'));
  rows.officeholders.push(holder('zz-fixture-far-county-commission', 'wikidata:Q900'));
  rows.given_name_aliases.push({
    source_key: 'william|bill',
    canonical: 'william',
    alias: 'bill',
    source: 'nicknames',
  });
  const zipCentroids: BZipCentroid[] = [
    { source_key: 'zcta:99001', zip: '99001', state: 'ZZ', lng: 0.5, lat: 0.5 },
    { source_key: 'zcta:99003', zip: '99003', state: 'ZZ', lng: 2.5, lat: 0.5 },
    { source_key: 'zcta:99005', zip: '99005', state: 'ZZ', lng: 10.5, lat: 10.5 },
  ];
  return {
    fullManifest: manifest('full'),
    geometryManifest: manifest('geometry'),
    rows,
    geometry: new Map([['ZZ', shapes]]),
    zipCentroids,
    listing: [
      listingRow('990001', '001'),
      listingRow('990002', '001'),
      listingRow('990007', '003'),
      listingRow('990009', '005'),
      listingRow('990010', '005'),
    ],
  };
}

const KEEP = {
  counties: ['99001', '99003'],
  states: ['ZZ'],
  overlapping: new Set(['tiger:cd:9901']),
} as const;

function keys(list: readonly { source_key: string }[]): string[] {
  return list.map((row) => row.source_key);
}

function shapeOf(selection: ReturnType<typeof selectSample>, key: string): BGeometry | undefined {
  return [...selection.geometry.values()].flat().find((entry) => entry.row.source_key === key)?.row;
}

describe('selectSample', () => {
  it('keeps the units of the named counties and the state', () => {
    const selection = selectSample(zzSource(), KEEP);
    expect(keys(selection.rows.jurisdictions)).toEqual(
      expect.arrayContaining([
        'state:ZZ',
        'census:990001',
        'census:990002',
        'census:990007',
        'coop:1001',
        'party:ZZ:99001:democratic',
      ]),
    );
    expect(keys(selection.rows.offices).sort()).toEqual(
      [
        'zz-governor',
        'zz-fixture-county-commission',
        'zz-fixture-city-council',
        'zz-fixture-second-county-commission',
        'zz-fixture-co-op-board',
        'zz-fixture-county-party-chair',
        'zz-us-house-1',
      ].sort(),
    );
    const officeKeys = new Set(keys(selection.rows.offices));
    expect(selection.rows.elections.every((row) => officeKeys.has(row.office_key))).toBe(true);
    expect(selection.rows.elections).toHaveLength(officeKeys.size);
    expect(selection.rows.filing_tracks).toHaveLength(officeKeys.size);
    expect(selection.rows.office_powers).toHaveLength(officeKeys.size);
    expect(selection.rows.given_name_aliases).toHaveLength(1);
    expect(keys(selection.zipCentroids)).toEqual(['zcta:99001', 'zcta:99003']);
  });

  it("drops the far county's units and offices", () => {
    const selection = selectSample(zzSource(), KEEP);
    const jurisdictions = keys(selection.rows.jurisdictions);
    expect(jurisdictions).not.toContain('census:990010');
    expect(jurisdictions).not.toContain('party:ZZ:99005:democratic');
    const offices = keys(selection.rows.offices);
    expect(offices).not.toContain('zz-fixture-far-county-commission');
    expect(offices).not.toContain('zz-fixture-far-city-council');
    expect(offices).not.toContain('zz-fixture-far-county-party-chair');
    expect(keys(selection.rows.districts)).not.toContain('tiger:place:9900010');
    expect(keys(selection.rows.people)).not.toContain('wikidata:Q900');
  });

  it('keeps a co-op serving a named county and its far via county as a reference', () => {
    const selection = selectSample(zzSource(), KEEP);
    expect(keys(selection.rows.district_fallbacks).sort()).toEqual(
      [
        'county_approx:coop:1001|tiger:county:99001',
        'county_approx:coop:1001|tiger:county:99005',
        'county_approx:party:ZZ:99001:democratic|tiger:county:99001',
      ].sort(),
    );
    const far = shapeOf(selection, 'tiger:county:99005');
    expect(far).toBeDefined();
    expect(far?.lookup_wkb).not.toBeNull();
    expect(far?.lookup_wkb).toBe(far?.display_wkb);
    const named = shapeOf(selection, 'tiger:county:99001');
    expect(named?.lookup_wkb).not.toBe(named?.display_wkb);
    expect(keys(selection.rows.jurisdictions)).toContain('census:990009');
    expect([...selection.referenceDistricts]).toEqual(['tiger:county:99005']);
    expect([...selection.referenceJurisdictions]).toEqual(['census:990009']);
    expect(
      selection.rows.offices.filter((row) => row.jurisdiction_key === 'census:990009'),
    ).toEqual([]);
  });

  it('keeps only overlapping legislative districts', () => {
    const selection = selectSample(zzSource(), KEEP);
    const districts = keys(selection.rows.districts);
    expect(districts).toContain('tiger:cd:9901');
    expect(districts).not.toContain('tiger:cd:9902');
    expect(keys(selection.rows.offices)).not.toContain('zz-us-house-2');
    const kept = shapeOf(selection, 'tiger:cd:9901');
    expect(kept?.lookup_wkb).not.toBe(kept?.display_wkb);

    const none = selectSample(zzSource(), { ...KEEP, overlapping: new Set() });
    expect(keys(none.rows.districts)).not.toContain('tiger:cd:9901');
    expect(keys(none.rows.offices)).not.toContain('zz-us-house-1');
  });

  it('caps photos at twenty by source key', () => {
    const selection = selectSample(zzSource(), KEEP);
    const byKey = [...selection.rows.people]
      .filter((row) => row.source_key !== 'wikidata:Q900')
      .sort((a, b) => Buffer.compare(Buffer.from(a.source_key), Buffer.from(b.source_key)));
    expect(byKey).toHaveLength(PEOPLE);
    const first = byKey.slice(0, SAMPLE_MAX_PHOTOS);
    const rest = byKey.slice(SAMPLE_MAX_PHOTOS);
    expect(rest.map((row) => row.source_key)).toEqual([
      'wikidata:Q5',
      'wikidata:Q6',
      'wikidata:Q7',
      'wikidata:Q8',
      'wikidata:Q9',
    ]);
    for (const row of rest) expect(row.photo).toBeNull();
    for (const row of first) {
      const n = Number(row.source_key.slice('wikidata:Q'.length));
      expect(row.photo?.asset).toBe(`../assets/photos/${photoSha(n)}.jpg`);
      expect(row.photo?.credit_text).toBe('Fixture credit');
    }
    expect(selection.assets).toHaveLength(SAMPLE_MAX_PHOTOS);
    expect(selection.assets.every((path) => path.startsWith('../assets/photos/'))).toBe(true);
  });

  it('every reference resolves inside the sample', () => {
    const selection = selectSample(zzSource(), KEEP);
    const geometry = new Map(
      [...selection.geometry.values()]
        .flat()
        .map((entry) => [entry.row.source_key, entry.row] as const),
    );
    expect(integrityCheck(selection.rows, geometry)).toEqual(
      expect.objectContaining({ passed: true }),
    );
    const jurisdictions = new Set(keys(selection.rows.jurisdictions));
    for (const row of selection.rows.jurisdictions) {
      if (row.parent_key !== null) expect(jurisdictions.has(row.parent_key)).toBe(true);
    }
  });

  it('replaces the state districts only when asked', () => {
    const selection = selectSample(zzSource(), KEEP);
    const list = selection.geometry.get('ZZ') ?? [];
    const state = (rows: readonly BGeometry[]) =>
      rows.find((row) => row.source_key === 'tiger:state:99');
    const kept = state(sampleGeometryRows(list, false));
    expect(kept?.lookup_wkb).not.toBe(kept?.display_wkb);
    const replaced = state(sampleGeometryRows(list, true));
    expect(replaced?.lookup_wkb).toBe(replaced?.display_wkb);
    const county = sampleGeometryRows(list, true).find(
      (row) => row.source_key === 'tiger:county:99001',
    );
    expect(county?.lookup_wkb).not.toBe(county?.display_wkb);
  });
});

describe('pointInMultiPolygon', () => {
  const holed: MultiPolygonCoords = [
    [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
    [
      [
        [20, 0],
        [30, 0],
        [30, 10],
        [20, 10],
        [20, 0],
      ],
    ],
  ];

  it('inside a square', () => {
    expect(pointInMultiPolygon(1, 1, holed)).toBe(true);
  });

  it('outside it', () => {
    expect(pointInMultiPolygon(15, 5, holed)).toBe(false);
    expect(pointInMultiPolygon(-1, 5, holed)).toBe(false);
  });

  it('inside a hole is outside', () => {
    expect(pointInMultiPolygon(5, 5, holed)).toBe(false);
  });

  it('on an edge is inside', () => {
    expect(pointInMultiPolygon(10, 5, holed)).toBe(true);
    expect(pointInMultiPolygon(0, 0, holed)).toBe(true);
    expect(pointInMultiPolygon(5, 4, holed)).toBe(true);
  });

  it('in the second polygon of a multipolygon is inside', () => {
    expect(pointInMultiPolygon(25, 5, holed)).toBe(true);
  });
});
