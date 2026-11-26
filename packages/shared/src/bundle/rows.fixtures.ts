import type { FieldMetaRow } from './common.ts';
import {
  censusJurisdictionKey,
  coopJurisdictionKey,
  countyApproxDistrictKey,
  districtFallbackKey,
  electionKey,
  filingTrackKey,
  givenNameAliasKey,
  officeholderKey,
  officePowerKey,
  personAliasKey,
  rosterPersonKey,
  stateJurisdictionKey,
  tigerDistrictKey,
  zctaKey,
} from './keys.ts';
import type { BundleManifest } from './manifest.ts';
import type {
  BDistrict,
  BDistrictFallback,
  BElection,
  BFilingTrack,
  BGeometry,
  BGivenNameAlias,
  BJurisdiction,
  BOffice,
  BOfficePower,
  BOfficeholder,
  BPerson,
  BPersonAlias,
  BZipCentroid,
} from './schemas.ts';

// Test fixtures: every value is made up (state ZZ, names starting "Fixture", links on example.test).

export const FIXTURE_HASH = '0123456789abcdef'.repeat(4);
export const FIXTURE_GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
export const FIXTURE_CHECKED_AT = '2026-11-16T03:00:00.000Z';
export const FIXTURE_SOURCE_URL = 'https://example.test/fixture-source';

const FIXTURE_PROOF: FieldMetaRow = {
  source_url: FIXTURE_SOURCE_URL,
  quote: 'Fixture quote from the fixture source.',
  confidence: 'medium',
  checked_at: FIXTURE_CHECKED_AT,
};

const STATE_KEY = stateJurisdictionKey('ZZ');
const COUNTY_KEY = censusJurisdictionKey('999001');
const COOP_KEY = coopJurisdictionKey('99901');
const COUNTY_DISTRICT_KEY = tigerDistrictKey('county', '99001');
const COOP_DISTRICT_KEY = countyApproxDistrictKey(COOP_KEY);
const OFFICE_SLUG = 'zz-fixture-county-board-of-commissioners';
const PERSON_KEY = rosterPersonKey(OFFICE_SLUG, 'fixture person');
const ELECTION_KEY = electionKey(OFFICE_SLUG, '2027-11-02', 'general', null);

const jurisdictions: BJurisdiction = {
  source_key: COUNTY_KEY,
  kind: 'county',
  name: 'Fixture County',
  state: 'ZZ',
  census_id: '999001',
  parent_key: STATE_KEY,
  population: 12000,
  website: 'https://example.test/fixture-county',
  timezone: 'America/New_York',
  budget_cents: null,
  budget_year: null,
  census_active: true,
  label_lng: null,
  label_lat: null,
  field_meta: { population: FIXTURE_PROOF },
};

const districts: BDistrict = {
  source_key: COUNTY_DISTRICT_KEY,
  jurisdiction_key: COUNTY_KEY,
  name: 'Fixture County',
  level: 'county',
  geometry_quality: 'exact',
  geom_hash: FIXTURE_HASH,
  population: 12000,
  population_18: null,
  lean: null,
  lean_basis: null,
  field_meta: { population: FIXTURE_PROOF },
};

const districtFallbacks: BDistrictFallback = {
  source_key: districtFallbackKey(COOP_DISTRICT_KEY, COUNTY_DISTRICT_KEY),
  district_key: COOP_DISTRICT_KEY,
  via_district_key: COUNTY_DISTRICT_KEY,
};

const geometry: BGeometry = {
  source_key: COUNTY_DISTRICT_KEY,
  lookup_wkb: '0106000000',
  display_wkb: '0106000000',
  label_point: [0, 0],
  outline_svg: 'M0 0L10 0L10 10Z',
  outline_bbox: [0, 0, 10, 10],
  geom_hash: FIXTURE_HASH,
};

const zipCentroids: BZipCentroid = {
  source_key: zctaKey('99999'),
  zip: '99999',
  state: 'ZZ',
  lng: 0,
  lat: 0,
};

const offices: BOffice = {
  source_key: OFFICE_SLUG,
  slug: OFFICE_SLUG,
  jurisdiction_key: COUNTY_KEY,
  district_key: COUNTY_DISTRICT_KEY,
  office_type_id: 'county-commission',
  title: 'Fixture County Board of Commissioners',
  placeholder: false,
  seats: 1,
  body_size: 5,
  seats_up_next: 3,
  vacant_seats_up_next: 1,
  term_years: 4,
  term_limit_terms: null,
  partisan: true,
  party_selection: null,
  electorate: 9000,
  pay_annual_cents: 1_200_000,
  pay_kind: 'salary',
  pay_amount_cents: 1_200_000,
  pay_period: 'year',
  pay_change_note: null,
  benefits: ['health'],
  hours_per_week: 12,
  full_time: false,
  meeting_times: ['evenings'],
  fits_day_job: 'yes',
  filing_fee_cents: 0,
  signatures_required: null,
  where_to_file: 'Fixture County Board of Elections',
  eligibility: [
    {
      kind: 'min_age',
      value: '18',
      quote: 'Fixture quote: a commissioner is at least 18.',
      source_url: FIXTURE_SOURCE_URL,
      confidence: 'medium',
    },
  ],
  field_meta: { pay_annual_cents: FIXTURE_PROOF, filing_fee_cents: FIXTURE_PROOF },
};

const officePowers: BOfficePower = {
  source_key: officePowerKey(OFFICE_SLUG, 'property-taxes'),
  office_key: OFFICE_SLUG,
  power_id: 'property-taxes',
  relevance: 3,
  quote: 'Fixture quote: the board sets the fixture tax rate.',
  source_url: FIXTURE_SOURCE_URL,
  confidence: 'medium',
  checked_at: FIXTURE_CHECKED_AT,
};

const elections: BElection = {
  source_key: ELECTION_KEY,
  office_key: OFFICE_SLUG,
  election_date: '2027-11-02',
  kind: 'general',
  party: null,
  turnout_class: 'odd_year_general',
  deadline_conflict: [
    {
      track: 'nonpartisan',
      field: 'closes_on',
      computed: { value: '2027-08-06', rule_citation: 'Fixture Code 1-1' },
      scraped: {
        value: '2027-08-07',
        source_url: FIXTURE_SOURCE_URL,
        quote: 'Fixture notice: filing closes on the fixture date.',
        checked_at: FIXTURE_CHECKED_AT,
      },
    },
  ],
  field_meta: { election_date: FIXTURE_PROOF },
};

const filingTracks: BFilingTrack = {
  source_key: filingTrackKey(ELECTION_KEY, 'nonpartisan'),
  election_key: ELECTION_KEY,
  track: 'nonpartisan',
  opens_on: '2027-07-05',
  closes_on: '2027-08-06',
  closes_time: null,
  petition_opens: null,
  petition_due: null,
  fee_cents: null,
  signatures: null,
  where_to_file: 'Fixture County Board of Elections, 100 Fixture Street',
  basis: 'computed',
  source_url: FIXTURE_SOURCE_URL,
  quote: 'Fixture quote: filing opens and closes on the fixture dates.',
  rule_citation: 'Fixture Code 1-1',
  confidence: 'medium',
  checked_at: FIXTURE_CHECKED_AT,
  field_meta: {},
};

const people: BPerson = {
  source_key: PERSON_KEY,
  slug: 'fixture-person-00000000',
  name: 'Fixture Person',
  first_name: 'Fixture',
  middle_name: null,
  last_name: 'Person',
  suffix: null,
  party: null,
  photo: {
    asset: `../../assets/photos/${FIXTURE_HASH}.jpg`,
    width: 400,
    height: 500,
    source_url: 'https://example.test/fixture-photo',
    author: 'Fixture Photographer',
    license: 'CC-BY-4.0',
    license_url: 'https://example.test/fixture-license',
    credit_text: 'Fixture Photographer, CC BY 4.0',
    modified: false,
    retrieved_at: FIXTURE_CHECKED_AT,
  },
  website: 'https://example.test/fixture-person',
  roster_only: true,
  origin: { created_by: 'bundle', key: PERSON_KEY, datasets: ['fixture-roster'] },
};

const personAliases: BPersonAlias = {
  source_key: personAliasKey(PERSON_KEY, 'Fix Person'),
  person_key: PERSON_KEY,
  alias: 'Fix Person',
};

const officeholders: BOfficeholder = {
  source_key: officeholderKey(OFFICE_SLUG, PERSON_KEY, '2023-12-04'),
  office_key: OFFICE_SLUG,
  person_key: PERSON_KEY,
  seat_label: 'Fixture Seat A',
  since: '2023-12-04',
  until: null,
  seat_up_next: true,
  term_limited: null,
  not_running: null,
  cash_on_hand_cents: 50_000,
  cash_as_of: '2026-10-01',
  cash_source_url: 'https://example.test/fixture-cash',
};

const givenNameAliases: BGivenNameAlias = {
  source_key: givenNameAliasKey('fixturename', 'fix'),
  canonical: 'fixturename',
  alias: 'fix',
  source: 'supplement',
};

/** One valid row per file kind of bundle schema revision 0. */
export const ROW_FIXTURES = {
  jurisdictions,
  districts,
  district_fallbacks: districtFallbacks,
  geometry,
  zip_centroids: zipCentroids,
  offices,
  office_powers: officePowers,
  elections,
  filing_tracks: filingTracks,
  people,
  person_aliases: personAliases,
  officeholders,
  given_name_aliases: givenNameAliases,
};

const file = (
  name: BundleManifest['files'][number]['name'],
  path: string,
  state: string | null = null,
) => ({
  name,
  state,
  path,
  sha256: FIXTURE_HASH,
  bytes: 1024,
  rows: 1,
});

const full: BundleManifest = {
  format: 'citizenrun-bundle',
  kind: 'full',
  version: '20261116T030000Z-full',
  schema_version: 1,
  schema_revision: 0,
  created_at: '2026-11-16T03:00:00.000Z',
  git_sha: FIXTURE_GIT_SHA,
  geometry_version: '20261116T000000Z-geometry',
  tiger_vintage: null,
  states: ['ZZ'],
  files: [
    file('jurisdictions', 'jurisdictions.ndjson.gz'),
    file('districts', 'districts.ndjson.gz'),
    file('offices', 'offices.ndjson.gz'),
  ],
  assets: [
    {
      path: `../../assets/photos/${FIXTURE_HASH}.jpg`,
      sha256: FIXTURE_HASH,
      kind: 'photo',
      bytes: 2048,
      content_type: 'image/jpeg',
    },
  ],
  datasets: {
    'census-gus': {
      edition: 'fixture-2022',
      downloaded_on: '2026-11-01',
      source_url: 'https://example.test/fixture-dataset',
    },
  },
  checks: [{ name: 'personal_data', passed: true, detail: 'Fixture check passed.' }],
  filing_sources: [],
  two_source_fields: 0,
  coverage_path: '../../reports/coverage/20261116T030000Z-full.json',
  attribution_path: 'ATTRIBUTION.md',
};

const filings: BundleManifest = {
  ...full,
  kind: 'filings',
  version: '20261116T040000Z-filings',
  created_at: '2026-11-16T04:00:00.000Z',
  geometry_version: null,
  files: [file('filings', 'filings.ndjson.gz')],
  assets: [],
  checks: [{ name: 'personal_data', passed: true, detail: 'Fixture check passed.' }],
  filing_sources: [
    {
      source: 'zz-fixture-list',
      state: 'ZZ',
      snapshot: 'full',
      fetched_at: '2026-11-16T03:30:00.000Z',
      rows: 1,
    },
  ],
  coverage_path: null,
  attribution_path: null,
};

const geometryManifest: BundleManifest = {
  ...full,
  kind: 'geometry',
  version: '20261116T000000Z-geometry',
  created_at: '2026-11-16T00:00:00.000Z',
  geometry_version: null,
  tiger_vintage: '2025',
  files: [
    file('geometry', 'geometry/ZZ.ndjson.gz', 'ZZ'),
    file('zip_centroids', 'zip_centroids.ndjson.gz'),
  ],
  assets: [],
  coverage_path: null,
  attribution_path: 'ATTRIBUTION.md',
};

/** One valid manifest of each bundle kind. */
export const MANIFEST_FIXTURES = { full, filings, geometry: geometryManifest };
