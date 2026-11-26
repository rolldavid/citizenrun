// Hand-written stage 4 rows for the fixture state ZZ, with today 2026-11-16: the elections the ZZ
// rules module gives the county commission, the sheriff, the city council's district 1 and one
// precinct committee office in the window of 400 days back and 1,095 days ahead, and their office
// refs; and one stage 2 senate district with its elections. Every value is written by hand.
import type { BElection, ElectionKind, TurnoutClass } from '@citizenrun/shared';
import type { OfficeRefRow } from '../../stages/shared/office-ref.ts';

export const ZZ_TODAY = '2026-11-16';
export const ZZ_NOW = new Date('2026-11-16T12:00:00.000Z');

export const COMMISSION = 'zz-fixture-county-board-of-commissioners';
export const SHERIFF = 'zz-fixture-county-sheriff';
export const COUNCIL_1 = 'zz-fixture-city-city-council-district-1';
export const PRECINCT_DEM = 'zz-fixture-county-democratic-party-precinct-committee-member';
export const SENATE_2 = 'zz-state-senator-district-2';

const CODE_URL = 'https://example.test/zz/code';

/** The schedule citations of the ZZ rules module, by number. */
const DATE_QUOTES: Readonly<Record<number, string>> = Object.freeze({
  101: 'Fixture text: the county general election is held on the November election day of each even year.',
  102: 'Fixture text: the state general election is held on the November election day of each even year.',
  103: 'Fixture text: city and district elections are held on the November election day of each odd year.',
  104: 'Fixture text: the primary election is held on the first Tuesday in May of each even year.',
});

function election(
  slug: string,
  date: string,
  kind: ElectionKind,
  party: string | null,
  turnout: TurnoutClass,
  code: 101 | 102 | 103 | 104,
): BElection {
  return {
    source_key: `${slug}|${date}|${kind}|${party ?? ''}`,
    office_key: slug,
    election_date: date,
    kind,
    party,
    turnout_class: turnout,
    deadline_conflict: null,
    field_meta: {
      election_date: {
        source_url: CODE_URL,
        quote: DATE_QUOTES[code] ?? '',
        confidence: 'medium',
        checked_at: '2026-11-16T12:00:00.000Z',
        rule_citation: `ZZ Fixture Code ${String(code)}`,
      },
    },
  };
}

/** The even-year contests of a partisan county office: two primaries and the general. */
function countyElections(slug: string): BElection[] {
  return [
    election(slug, '2026-05-05', 'primary', 'democratic', 'primary', 104),
    election(slug, '2026-05-05', 'primary', 'republican', 'primary', 104),
    election(slug, '2026-11-03', 'general', null, 'midterm_general', 101),
    election(slug, '2028-05-02', 'primary', 'democratic', 'primary', 104),
    election(slug, '2028-05-02', 'primary', 'republican', 'primary', 104),
    election(slug, '2028-11-07', 'general', null, 'presidential_general', 101),
  ];
}

export const ZZ_ELECTIONS: readonly BElection[] = [
  ...countyElections(COMMISSION),
  ...countyElections(SHERIFF),
  election(COUNCIL_1, '2025-11-04', 'general', null, 'odd_year_general', 103),
  election(COUNCIL_1, '2027-11-02', 'general', null, 'odd_year_general', 103),
  election(COUNCIL_1, '2029-11-06', 'general', null, 'odd_year_general', 103),
  election(PRECINCT_DEM, '2026-05-05', 'primary', 'democratic', 'primary', 104),
  election(PRECINCT_DEM, '2028-05-02', 'primary', 'democratic', 'primary', 104),
];

const REF_DEFAULTS = {
  party: null,
  party_selection: null,
  stagger: [],
  stagger_group: null,
  body_size: null,
  pay_annual_cents: null,
  pay_range: null,
  template_seats: null,
  population: null,
} as const satisfies Partial<OfficeRefRow>;

export const COMMISSION_REF: OfficeRefRow = {
  ...REF_DEFAULTS,
  slug: COMMISSION,
  identity: 'census:990001|county-commissioner|tiger:county:99001',
  origin: 's04-expand',
  template_key: 'county-commissioner',
  office_type_id: 'county-commission',
  jurisdiction_key: 'census:990001',
  jurisdiction_kind: 'county',
  district_key: 'tiger:county:99001',
  county_geoid: '99001',
  partisan: true,
  schedule: 'zz_county_general',
  track_set: 'zz_partisan',
  stagger: [
    { group: 'A', seats: 3, every: 4, first: 2026 },
    { group: 'B', seats: 2, every: 4, first: 2028 },
  ],
  seats: 5,
  body_size: 5,
  term_years: 4,
  pay_annual_cents: 4_500_000,
  template_seats: 5,
};

export const SHERIFF_REF: OfficeRefRow = {
  ...REF_DEFAULTS,
  slug: SHERIFF,
  identity: 'census:990001|sheriff|tiger:county:99001',
  origin: 's04-expand',
  template_key: 'sheriff',
  office_type_id: 'sheriff',
  jurisdiction_key: 'census:990001',
  jurisdiction_kind: 'county',
  district_key: 'tiger:county:99001',
  county_geoid: '99001',
  partisan: true,
  schedule: 'zz_county_general',
  track_set: 'zz_partisan',
  seats: 1,
  term_years: 4,
  pay_annual_cents: 8_000_000,
  template_seats: 1,
};

export const COUNCIL_1_REF: OfficeRefRow = {
  ...REF_DEFAULTS,
  slug: COUNCIL_1,
  identity: 'census:990002|city-council|parent_fallback:census:990002:district-1',
  origin: 's04-expand',
  template_key: 'city-council',
  office_type_id: 'city-council',
  jurisdiction_key: 'census:990002',
  jurisdiction_kind: 'city',
  district_key: 'parent_fallback:census:990002:district-1',
  county_geoid: '99001',
  partisan: false,
  schedule: 'zz_local_odd',
  track_set: 'zz_nonpartisan',
  seats: 1,
  term_years: 4,
  template_seats: 1,
};

export const PRECINCT_DEM_REF: OfficeRefRow = {
  ...REF_DEFAULTS,
  slug: PRECINCT_DEM,
  identity: 'party:ZZ:99001:democratic|precinct-committee|county_approx:party:ZZ:99001:democratic',
  origin: 's04-expand',
  template_key: 'precinct-committee',
  office_type_id: 'party-precinct-committee',
  jurisdiction_key: 'party:ZZ:99001:democratic',
  jurisdiction_kind: 'party',
  district_key: 'county_approx:party:ZZ:99001:democratic',
  county_geoid: '99001',
  party: 'democratic',
  party_selection: 'primary_ballot',
  partisan: true,
  schedule: 'zz_state_primary',
  track_set: 'zz_party',
  seats: 1,
  term_years: null,
  template_seats: 1,
};

export const ZZ_S04_REFS: readonly OfficeRefRow[] = [
  COMMISSION_REF,
  SHERIFF_REF,
  COUNCIL_1_REF,
  PRECINCT_DEM_REF,
];

/** A stage 2 senate office of group B, elected in 2028 only within the window. */
export const SENATE_2_REF: OfficeRefRow = {
  ...REF_DEFAULTS,
  slug: SENATE_2,
  identity: 'state:ZZ|state-senate|tiger:sldu:99002',
  origin: 's02-known',
  template_key: null,
  office_type_id: 'state-senate',
  jurisdiction_key: 'state:ZZ',
  jurisdiction_kind: 'state',
  district_key: 'tiger:sldu:99002',
  county_geoid: null,
  partisan: true,
  schedule: 'zz_state_general',
  track_set: 'zz_partisan',
  stagger: [{ group: 'B', seats: 1, every: 4, first: 2028 }],
  stagger_group: 'B',
  seats: 1,
  term_years: 4,
};

export const ZZ_KNOWN_REFS: readonly OfficeRefRow[] = [SENATE_2_REF];

export const ZZ_KNOWN_ELECTIONS: readonly BElection[] = [
  election(SENATE_2, '2028-05-02', 'primary', 'democratic', 'primary', 104),
  election(SENATE_2, '2028-05-02', 'primary', 'republican', 'primary', 104),
  election(SENATE_2, '2028-11-07', 'general', null, 'presidential_general', 102),
];
