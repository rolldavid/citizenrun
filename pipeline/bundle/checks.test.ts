import { describe, expect, it } from 'vitest';
import { emptyRows } from './assemble.ts';
import type { AssembledRows } from './assemble.ts';
import { copyStage1Checks, integrityCheck, personalDataCheck } from './checks.ts';
import type { BundleInputs } from './inputs.ts';
import {
  alias,
  district,
  election,
  geometry,
  holder,
  jurisdiction,
  office,
  person,
  power,
  stageMeta,
  stateInputs,
  track,
} from './testing/rows.ts';

function rowsWith(extra: Partial<AssembledRows>): AssembledRows {
  return { ...emptyRows(), ...extra };
}

/** A small bundle whose keys all resolve. */
function sound(): AssembledRows {
  return rowsWith({
    jurisdictions: [
      jurisdiction('state:ZZ', { kind: 'state' }),
      jurisdiction('census:1', { parent_key: 'state:ZZ' }),
    ],
    districts: [
      district('tiger:state:99'),
      district('county_approx:census:1', {
        jurisdiction_key: 'census:1',
        geometry_quality: 'county_approx',
        geom_hash: 'c'.repeat(64),
      }),
    ],
    district_fallbacks: [
      {
        source_key: 'county_approx:census:1|tiger:state:99',
        district_key: 'county_approx:census:1',
        via_district_key: 'tiger:state:99',
      },
    ],
    offices: [office('zz-a', { where_to_file: 'Fixture Board of Elections, 123 Main Street' })],
    office_powers: [power('zz-a', 'budget')],
    elections: [election('zz-a', '2027-11-02')],
    filing_tracks: [track('zz-a|2027-11-02|general|')],
    people: [person('bioguide:Z000001')],
    person_aliases: [alias('bioguide:Z000001', 'Fix Person')],
    officeholders: [holder('zz-a', 'bioguide:Z000001')],
  });
}

function shapes(): Map<string, ReturnType<typeof geometry>> {
  return new Map([
    ['tiger:state:99', geometry('tiger:state:99')],
    [
      'county_approx:census:1',
      geometry('county_approx:census:1', {
        lookup_wkb: null,
        display_wkb: null,
        geom_hash: 'c'.repeat(64),
      }),
    ],
  ]);
}

describe('personalDataCheck', () => {
  it('finds a phone number in an alias and a PO box in a person name', () => {
    const rows = rowsWith({
      people: [
        person('bioguide:Z000001', { name: 'Fixture PO Box 12' }),
        person('bioguide:Z000002'),
      ],
      person_aliases: [alias('bioguide:Z000002', 'Fixture 919-555-0100')],
    });
    const check = personalDataCheck(rows);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain('people:bioguide:Z000001');
    expect(check.detail).toContain('person_aliases:bioguide:Z000002|Fixture 919-555-0100');
    expect(check.detail).toMatch(/^matches=2 /);
  });

  it('scans nested strings, the photo record among them', () => {
    const rows = rowsWith({
      people: [
        person('bioguide:Z000003', {
          photo: {
            asset: `../../assets/photos/${'b'.repeat(64)}.jpg`,
            width: 1,
            height: 1,
            source_url: 'https://example.test/p',
            author: 'fixture@example.test',
            license: 'CC0-1.0',
            license_url: 'https://example.test/l',
            credit_text: 'Fixture',
            modified: false,
            retrieved_at: '2026-11-01T00:00:00.000Z',
          },
        }),
      ],
    });
    expect(personalDataCheck(rows).passed).toBe(false);
  });

  it('passes where_to_file text with an address', () => {
    const check = personalDataCheck(sound());
    expect(check).toEqual({ name: 'personal_data', passed: true, detail: 'matches=0' });
  });
});

describe('integrityCheck', () => {
  it('passes a bundle whose keys resolve', () => {
    expect(integrityCheck(sound(), shapes())).toMatchObject({
      name: 'referential_integrity',
      passed: true,
    });
  });

  it.each<[string, (rows: AssembledRows) => void]>([
    [
      'jurisdictions.parent_key',
      (r) => {
        r.jurisdictions[1] = jurisdiction('census:1', { parent_key: 'state:XX' });
      },
    ],
    [
      'districts.jurisdiction_key',
      (r) => {
        r.districts[0] = district('tiger:state:99', { jurisdiction_key: 'census:9' });
      },
    ],
    [
      'district_fallbacks.district_key',
      (r) => {
        r.district_fallbacks[0] = {
          source_key: 'x|tiger:state:99',
          district_key: 'x',
          via_district_key: 'tiger:state:99',
        };
      },
    ],
    [
      'district_fallbacks.via_district_key',
      (r) => {
        r.district_fallbacks[0] = {
          source_key: 'county_approx:census:1|y',
          district_key: 'county_approx:census:1',
          via_district_key: 'y',
        };
      },
    ],
    [
      'district_fallbacks.via_not_exact',
      (r) => {
        r.district_fallbacks[0] = {
          source_key: 'a|county_approx:census:1',
          district_key: 'county_approx:census:1',
          via_district_key: 'county_approx:census:1',
        };
      },
    ],
    [
      'offices.jurisdiction_key',
      (r) => {
        r.offices[0] = office('zz-a', { jurisdiction_key: 'census:9' });
      },
    ],
    [
      'offices.district_key',
      (r) => {
        r.offices[0] = office('zz-a', { district_key: 'tiger:county:99999' });
      },
    ],
    [
      'office_powers.office_key',
      (r) => {
        r.office_powers[0] = power('zz-b', 'budget');
      },
    ],
    [
      'elections.office_key',
      (r) => {
        r.elections[0] = election('zz-b', '2027-11-02');
      },
    ],
    [
      'filing_tracks.election_key',
      (r) => {
        r.filing_tracks[0] = track('zz-b|2027-11-02|general|');
      },
    ],
    [
      'officeholders.office_key',
      (r) => {
        r.officeholders[0] = holder('zz-b', 'bioguide:Z000001');
      },
    ],
    [
      'officeholders.person_key',
      (r) => {
        r.officeholders[0] = holder('zz-a', 'bioguide:Z000009');
      },
    ],
    [
      'person_aliases.person_key',
      (r) => {
        r.person_aliases[0] = alias('bioguide:Z000009', 'Fix');
      },
    ],
    [
      'geometry.missing',
      (r) => {
        r.districts.push(district('tiger:county:99001'));
      },
    ],
    [
      'duplicate.offices',
      (r) => {
        r.offices.push(office('zz-a'));
      },
    ],
  ])('finds a dangling or repeated key: %s', (kind, change) => {
    const rows = sound();
    change(rows);
    const check = integrityCheck(rows, shapes());
    expect(check.passed).toBe(false);
    expect(check.detail).toContain(`${kind}=1`);
  });

  it("finds a district whose geom_hash differs from its geometry row's", () => {
    const geo = shapes();
    geo.set('tiger:state:99', geometry('tiger:state:99', { geom_hash: 'd'.repeat(64) }));
    expect(integrityCheck(sound(), geo).detail).toContain('geometry.geom_hash=1 (tiger:state:99)');
  });

  it('finds an exact district without WKB and an approximate one with it', () => {
    const geo = shapes();
    geo.set('tiger:state:99', geometry('tiger:state:99', { display_wkb: null }));
    geo.set(
      'county_approx:census:1',
      geometry('county_approx:census:1', { geom_hash: 'c'.repeat(64) }),
    );
    expect(integrityCheck(sound(), geo).detail).toContain('geometry.wkb=2');
  });
});

describe('copyStage1Checks', () => {
  function bundleInputs(extra: Partial<BundleInputs>): BundleInputs {
    return {
      states: [],
      missing: [],
      zipCentroids: [],
      zipMeta: null,
      givenNameAliases: [],
      givenNameMeta: null,
      listingWebsites: new Map(),
      boundarySources: [],
      ...extra,
    };
  }

  it('passes when every state passed and fails a check a newer failure names', () => {
    const passing = bundleInputs({ states: [stateInputs()] });
    expect(copyStage1Checks(passing).map((c) => [c.name, c.passed])).toEqual([
      ['listing_header', true],
      ['unit_counts', true],
      ['join_rate', true],
      ['geometry_valid:ZZ', true],
    ]);
    const failing = bundleInputs({
      states: [
        stateInputs({
          base: {
            meta: stageMeta('s01-base', 'ZZ', { finished_at: '2026-11-01T00:00:00.000Z' }),
            failure: {
              runId: 'r2',
              finishedAt: '2026-11-02T00:00:00.000Z',
              failedChecks: ['join_rate', 'geometry_valid:ZZ'],
              error: null,
            },
          },
        }),
      ],
    });
    const checks = copyStage1Checks(failing);
    expect(checks.find((c) => c.name === 'join_rate')).toMatchObject({
      passed: false,
      detail: 'states=1 failing=ZZ',
    });
    expect(checks.find((c) => c.name === 'geometry_valid:ZZ')?.passed).toBe(false);
    expect(checks.find((c) => c.name === 'unit_counts')?.passed).toBe(true);
  });

  it('an older failure does not count', () => {
    const older = bundleInputs({
      states: [
        stateInputs({
          base: {
            meta: stageMeta('s01-base', 'ZZ', { finished_at: '2026-11-03T00:00:00.000Z' }),
            failure: {
              runId: 'r1',
              finishedAt: '2026-11-02T00:00:00.000Z',
              failedChecks: ['join_rate'],
              error: null,
            },
          },
        }),
      ],
    });
    expect(copyStage1Checks(older).every((c) => c.passed)).toBe(true);
  });
});
