import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { looksPersonal } from './personal-data.ts';
import { ROW_FIXTURES } from './rows.fixtures.ts';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BElectionSchema,
  BFilingTrackSchema,
  BGeometrySchema,
  BGivenNameAliasSchema,
  BJurisdictionSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BOfficeholderSchema,
  BPersonAliasSchema,
  BPersonSchema,
  BZipCentroidSchema,
} from './schemas.ts';

type FileKind = keyof typeof ROW_FIXTURES;

const SCHEMAS: Record<FileKind, z.ZodType> = {
  jurisdictions: BJurisdictionSchema,
  districts: BDistrictSchema,
  district_fallbacks: BDistrictFallbackSchema,
  geometry: BGeometrySchema,
  zip_centroids: BZipCentroidSchema,
  offices: BOfficeSchema,
  office_powers: BOfficePowerSchema,
  elections: BElectionSchema,
  filing_tracks: BFilingTrackSchema,
  people: BPersonSchema,
  person_aliases: BPersonAliasSchema,
  officeholders: BOfficeholderSchema,
  given_name_aliases: BGivenNameAliasSchema,
};

const KINDS = Object.keys(SCHEMAS) as FileKind[]; // Object.keys widens to string[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A deep copy of the fixture row of `kind` with `value` written at `path` (array indexes as numbers). */
function rowWith(kind: FileKind, path: readonly (string | number)[], value: unknown): unknown {
  const row: unknown = structuredClone(ROW_FIXTURES[kind]);
  let target: unknown = row;
  for (const step of path.slice(0, -1)) {
    if (!isRecord(target)) {
      throw new Error(`no object at ${path.join('.')}`);
    }
    target = target[String(step)];
  }
  const last = path[path.length - 1];
  if (!isRecord(target) || last === undefined || !(String(last) in target)) {
    throw new Error(`no field at ${path.join('.')}`);
  }
  target[String(last)] = value;
  return row;
}

function passes(kind: FileKind, row: unknown): boolean {
  return SCHEMAS[kind].safeParse(row).success;
}

function stringsOf(value: unknown, key: string, out: { key: string; value: string }[]): void {
  if (typeof value === 'string') {
    out.push({ key, value });
  } else if (Array.isArray(value)) {
    for (const item of value) stringsOf(item, key, out);
  } else if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) stringsOf(v, k, out);
  }
}

const URL_FIELDS: readonly [FileKind, readonly (string | number)[]][] = [
  ['jurisdictions', ['website']],
  ['jurisdictions', ['field_meta', 'population', 'source_url']],
  ['districts', ['field_meta', 'population', 'source_url']],
  ['offices', ['field_meta', 'pay_annual_cents', 'source_url']],
  ['offices', ['eligibility', 0, 'source_url']],
  ['office_powers', ['source_url']],
  ['elections', ['field_meta', 'election_date', 'source_url']],
  ['elections', ['deadline_conflict', 0, 'scraped', 'source_url']],
  ['filing_tracks', ['source_url']],
  ['people', ['website']],
  ['people', ['photo', 'source_url']],
  ['people', ['photo', 'license_url']],
  ['officeholders', ['cash_source_url']],
];

describe('bundle row schemas', () => {
  it('accepts a valid row of every file kind', () => {
    expect(KINDS).toHaveLength(13);
    for (const kind of KINDS) {
      const result = SCHEMAS[kind].safeParse(ROW_FIXTURES[kind]);
      expect(result.success, kind).toBe(true);
    }
  });

  it('links are https only', () => {
    for (const [kind, path] of URL_FIELDS) {
      expect(
        passes(kind, rowWith(kind, path, 'https://example.test/fixture-ok')),
        path.join('.'),
      ).toBe(true);
      for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://example.test/x']) {
        expect(passes(kind, rowWith(kind, path, bad)), `${kind} ${path.join('.')} ${bad}`).toBe(
          false,
        );
      }
    }
  });

  it('outlines are path data', () => {
    const outline = ['outline_svg'];
    expect(passes('geometry', rowWith('geometry', outline, '<script>alert(1)</script>'))).toBe(
      false,
    );
    expect(passes('geometry', rowWith('geometry', outline, 'M0 0Q5 5 10 10Z'))).toBe(false);
    const longest = `M0 0${'L1 1'.repeat(4999)}`;
    expect(longest).toHaveLength(20_000);
    expect(passes('geometry', rowWith('geometry', outline, longest))).toBe(true);
    expect(passes('geometry', rowWith('geometry', outline, `${longest}Z`))).toBe(false);
    expect(passes('geometry', rowWith('geometry', outline, 'M0 0L10 0L10 10Z'))).toBe(true);
  });

  it('strict rows', () => {
    for (const kind of KINDS) {
      const row = { ...ROW_FIXTURES[kind], unknown_key: 'x' };
      expect(passes(kind, row), kind).toBe(false);
    }
  });

  it('refinements hold', () => {
    const office = ROW_FIXTURES.offices;
    expect(
      passes('offices', { ...office, seats_up_next: 4, body_size: 3, vacant_seats_up_next: 0 }),
    ).toBe(false);
    expect(passes('offices', { ...office, seats_up_next: 2, vacant_seats_up_next: 3 })).toBe(false);
    expect(
      passes('offices', {
        ...office,
        office_type_id: 'county-commission',
        party_selection: 'caucus',
      }),
    ).toBe(false);
    expect(
      passes('offices', {
        ...office,
        office_type_id: 'party-committee',
        party_selection: 'caucus',
      }),
    ).toBe(true);
    const placeholder = {
      ...office,
      placeholder: true,
      filing_fee_cents: null,
      signatures_required: null,
      where_to_file: null,
    };
    expect(passes('offices', { ...placeholder, pay_annual_cents: null })).toBe(true);
    expect(passes('offices', { ...placeholder, pay_annual_cents: 100 })).toBe(false);

    expect(passes('office_powers', { ...ROW_FIXTURES.office_powers, quote: null })).toBe(false);
    expect(
      passes('office_powers', {
        ...ROW_FIXTURES.office_powers,
        confidence: 'low',
        quote: null,
        source_url: null,
      }),
    ).toBe(true);

    const track = ROW_FIXTURES.filing_tracks;
    expect(passes('filing_tracks', { ...track, closes_on: null, closes_time: '12:00' })).toBe(
      false,
    );
    expect(passes('filing_tracks', { ...track, closes_time: '12:00' })).toBe(true);
    expect(passes('filing_tracks', { ...track, opens_on: '2027-08-07' })).toBe(false);
    const lowEmpty = {
      ...track,
      confidence: 'low',
      opens_on: null,
      closes_on: null,
      where_to_file: null,
      source_url: null,
      quote: null,
    };
    expect(passes('filing_tracks', lowEmpty)).toBe(true);
    expect(passes('filing_tracks', { ...lowEmpty, closes_on: '2027-08-06' })).toBe(false);
    expect(passes('filing_tracks', { ...lowEmpty, fee_cents: 0 })).toBe(false);
    expect(passes('filing_tracks', { ...lowEmpty, where_to_file: 'Fixture office' })).toBe(false);
    expect(
      passes('filing_tracks', {
        ...lowEmpty,
        closes_on: '2027-08-06',
        source_url: 'https://example.test/x',
      }),
    ).toBe(true);
    expect(passes('filing_tracks', { ...track, confidence: 'medium', quote: null })).toBe(false);

    expect(passes('elections', { ...ROW_FIXTURES.elections, deadline_conflict: [] })).toBe(false);
    expect(passes('elections', { ...ROW_FIXTURES.elections, deadline_conflict: null })).toBe(true);
  });

  it('no personal contact fields', () => {
    for (const kind of KINDS) {
      const strings: { key: string; value: string }[] = [];
      stringsOf(ROW_FIXTURES[kind], '', strings);
      for (const { key, value } of strings) {
        if (key === 'where_to_file') continue;
        expect(looksPersonal(value), `${kind}.${key}: ${value}`).toBe(false);
      }
    }
    // where_to_file names an election office, whose public address may appear, so it is not scanned.
    expect(looksPersonal(ROW_FIXTURES.filing_tracks.where_to_file ?? '')).toBe(true);
  });
});
