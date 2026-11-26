// Fixture rows for the bundle writer's unit tests. Every value is made up for the tests.
import type {
  BDistrict,
  BElection,
  BFilingTrack,
  BGeometry,
  BJurisdiction,
  BOffice,
  BOfficePower,
  BOfficeholder,
  BPerson,
  BPersonAlias,
  FieldMetaRow,
} from '@citizenrun/shared';
import type { StageId, StageMeta } from '../../lib/runner.ts';
import type { OfficeRefRow } from '../../stages/shared/office-ref.ts';
import type { StateInputs } from '../inputs.ts';

export const FIXTURE_URL = 'https://example.test/zz/source';
export const FIXTURE_CHECKED = '2026-11-01T00:00:00.000Z';
export const FIXTURE_HASH = 'a'.repeat(64);

export function proof(extra: Partial<FieldMetaRow> = {}): FieldMetaRow {
  return {
    source_url: FIXTURE_URL,
    quote: 'Fixture quote.',
    confidence: 'medium',
    checked_at: FIXTURE_CHECKED,
    ...extra,
  };
}

export function jurisdiction(key: string, extra: Partial<BJurisdiction> = {}): BJurisdiction {
  return {
    source_key: key,
    kind: 'county',
    name: 'Fixture County',
    state: 'ZZ',
    census_id: null,
    parent_key: null,
    population: null,
    website: null,
    timezone: null,
    budget_cents: null,
    budget_year: null,
    census_active: null,
    label_lng: null,
    label_lat: null,
    field_meta: {},
    ...extra,
  };
}

export function district(key: string, extra: Partial<BDistrict> = {}): BDistrict {
  return {
    source_key: key,
    jurisdiction_key: 'state:ZZ',
    name: 'Fixture District',
    level: 'county',
    geometry_quality: 'exact',
    geom_hash: FIXTURE_HASH,
    population: null,
    population_18: null,
    lean: null,
    lean_basis: null,
    field_meta: {},
    ...extra,
  };
}

export function geometry(key: string, extra: Partial<BGeometry> = {}): BGeometry {
  return {
    source_key: key,
    lookup_wkb: '0106000000',
    display_wkb: '0106000000',
    label_point: [0, 0],
    outline_svg: 'M0 0L10 0L10 10Z',
    outline_bbox: [0, 0, 10, 10],
    geom_hash: FIXTURE_HASH,
    ...extra,
  };
}

export function office(slug: string, extra: Partial<BOffice> = {}): BOffice {
  return {
    source_key: slug,
    slug,
    jurisdiction_key: 'state:ZZ',
    district_key: 'tiger:state:99',
    office_type_id: 'county-commission',
    title: 'Fixture Office',
    placeholder: false,
    seats: 1,
    body_size: null,
    seats_up_next: null,
    vacant_seats_up_next: null,
    term_years: null,
    term_limit_terms: null,
    partisan: null,
    party_selection: null,
    electorate: null,
    pay_annual_cents: null,
    pay_kind: null,
    pay_amount_cents: null,
    pay_period: null,
    pay_change_note: null,
    benefits: null,
    hours_per_week: null,
    full_time: null,
    meeting_times: null,
    fits_day_job: null,
    filing_fee_cents: null,
    signatures_required: null,
    where_to_file: null,
    eligibility: null,
    field_meta: {},
    ...extra,
  };
}

export function power(
  officeKey: string,
  powerId: string,
  extra: Partial<BOfficePower> = {},
): BOfficePower {
  return {
    source_key: `${officeKey}|${powerId}`,
    office_key: officeKey,
    power_id: powerId,
    relevance: 2,
    quote: null,
    source_url: null,
    confidence: 'low',
    checked_at: null,
    ...extra,
  };
}

export function election(
  officeKey: string,
  date: string,
  extra: Partial<BElection> = {},
): BElection {
  return {
    source_key: `${officeKey}|${date}|general|`,
    office_key: officeKey,
    election_date: date,
    kind: 'general',
    party: null,
    turnout_class: 'midterm_general',
    deadline_conflict: null,
    field_meta: {},
    ...extra,
  };
}

export function track(electionKey: string, extra: Partial<BFilingTrack> = {}): BFilingTrack {
  return {
    source_key: `${electionKey}|nonpartisan`,
    election_key: electionKey,
    track: 'nonpartisan',
    opens_on: null,
    closes_on: null,
    closes_time: null,
    petition_opens: null,
    petition_due: null,
    fee_cents: null,
    signatures: null,
    where_to_file: null,
    basis: 'computed',
    source_url: FIXTURE_URL,
    quote: 'Fixture quote.',
    rule_citation: 'Fixture Code 1-1',
    confidence: 'medium',
    checked_at: FIXTURE_CHECKED,
    field_meta: {},
    ...extra,
  };
}

export function person(key: string, extra: Partial<BPerson> = {}): BPerson {
  return {
    source_key: key,
    slug: 'fixture-person-00000000',
    name: 'Fixture Person',
    first_name: 'Fixture',
    middle_name: null,
    last_name: 'Person',
    suffix: null,
    party: null,
    photo: null,
    website: null,
    roster_only: false,
    origin: { created_by: 'bundle', key, datasets: ['openstates'] },
    ...extra,
  };
}

export function alias(personKey: string, text: string): BPersonAlias {
  return { source_key: `${personKey}|${text}`, person_key: personKey, alias: text };
}

export function holder(
  officeKey: string,
  personKey: string,
  extra: Partial<BOfficeholder> = {},
): BOfficeholder {
  return {
    source_key: `${officeKey}|${personKey}|`,
    office_key: officeKey,
    person_key: personKey,
    seat_label: null,
    since: null,
    until: null,
    seat_up_next: null,
    term_limited: null,
    not_running: null,
    cash_on_hand_cents: null,
    cash_as_of: null,
    cash_source_url: null,
    ...extra,
  };
}

export function officeRef(slug: string, extra: Partial<OfficeRefRow> = {}): OfficeRefRow {
  return {
    slug,
    identity: `state:ZZ|${slug}|state:ZZ`,
    origin: 's04-expand',
    template_key: null,
    office_type_id: 'county-commission',
    jurisdiction_key: 'state:ZZ',
    jurisdiction_kind: 'state',
    district_key: 'state:ZZ',
    county_geoid: null,
    party: null,
    party_selection: null,
    partisan: null,
    schedule: null,
    track_set: null,
    stagger: [],
    stagger_group: null,
    seats: 1,
    body_size: null,
    term_years: null,
    pay_annual_cents: null,
    pay_range: null,
    template_seats: null,
    population: null,
    ...extra,
  };
}

export function stageMeta(stage: StageId, state = 'ZZ', extra: Partial<StageMeta> = {}): StageMeta {
  return {
    stage,
    state,
    run_id: 'fixture-run',
    started_at: FIXTURE_CHECKED,
    finished_at: FIXTURE_CHECKED,
    git_sha: null,
    files: [],
    checks: [],
    datasets: {},
    ...extra,
  };
}

/** A state's inputs with a stage 1 output and nothing else; `extra` fills any part. */
export function stateInputs(
  extra: { [K in keyof StateInputs]?: Partial<StateInputs[K]> } = {},
): StateInputs {
  return {
    state: extra.state ?? 'ZZ',
    fips: extra.fips === undefined ? '99' : extra.fips,
    base: {
      meta: stageMeta('s01-base'),
      failure: null,
      jurisdictions: [],
      districts: [],
      district_fallbacks: [],
      geometry: [],
      coverage: [],
      ...extra.base,
    },
    known: {
      meta: stageMeta('s02-known'),
      offices: [],
      office_powers: [],
      people: [],
      officeholders: [],
      office_refs: [],
      ...extra.known,
    },
    coops: {
      meta: null,
      jurisdictions: [],
      districts: [],
      district_fallbacks: [],
      geometry: [],
      offices: [],
      office_powers: [],
      people: [],
      officeholders: [],
      office_refs: [],
      facts: [],
      ...extra.coops,
    },
    templates: { meta: null, failure: null, output: null, quotes: [], ...extra.templates },
    expand: {
      meta: null,
      offices: [],
      office_powers: [],
      elections: [],
      jurisdictions: [],
      districts: [],
      district_fallbacks: [],
      geometry: [],
      office_refs: [],
      ...extra.expand,
    },
    deadlines: { meta: null, filing_tracks: [], facts: [], ...extra.deadlines },
    people: {
      meta: stageMeta('s09-people'),
      people: [],
      person_aliases: [],
      officeholders: [],
      assets: [],
      ...extra.people,
    },
    blockedHosts: (extra.blockedHosts as readonly string[] | undefined) ?? [],
  };
}
