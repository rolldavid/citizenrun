// Jurisdiction rows of stage 1 (B-jurisdictions): one per listing unit and one per state, built in
// the schema's key order and parsed before they are written.
import { BJurisdictionSchema } from '@citizenrun/shared';
import type { BJurisdiction, FieldMetaMap, FieldMetaRow } from '@citizenrun/shared';
import type { TimezoneRegister } from '../../lib/timezones.ts';
import { zoneForCounty, zoneForState, zoneForUnit, zoneProof } from '../../lib/timezones.ts';
import type { ParsedListingRow } from '../../sources/census-gus.ts';
import { LISTING_URL } from '../../sources/census-gus.ts';
import { titleCaseUnitName } from './listing.ts';
import type { UnitKind } from './listing.ts';
import { listingPopulation } from './population.ts';

export const unitKey = (pid6: string): string => `census:${pid6}`;
export const stateKey = (state: string): string => `state:${state}`;

/**
 * A unit's zone (PIPE-timezones): a county its override or the state's default, any other unit
 * its county's zone. A unit with no county code takes the default only when the state has no
 * county override, since it cannot be placed otherwise. Null for a state with no entry.
 */
export function unitTimezone(
  reg: TimezoneRegister,
  state: string,
  unit: { kind: UnitKind; fips_state: string; fips_county: string | null },
): string | null {
  if (unit.fips_county === null) {
    const entry = reg.get(state);
    return entry !== undefined && entry.county_overrides.length === 0 ? entry.default : null;
  }
  return unit.kind === 'county'
    ? zoneForCounty(reg, state, `${unit.fips_state}${unit.fips_county}`)
    : zoneForUnit(reg, state, unit.fips_state, unit.fips_county);
}

/** The unit's name: an override's as given, else the joined feature's NAMELSAD, else the title-cased listing name. */
export function jurisdictionName(
  listedName: string,
  joinedName: string | null,
  overrideName: string | null,
): string {
  return overrideName ?? joinedName ?? titleCaseUnitName(listedName);
}

/** The proof of a validated website: the listing row it came from. */
export function websiteMeta(pid6: string, listedAddress: string, checkedAt: string): FieldMetaRow {
  return {
    source_url: LISTING_URL,
    quote: `PID6 ${pid6}: WEB_ADDRESS ${listedAddress}`,
    confidence: 'medium',
    checked_at: checkedAt,
  };
}

export type UnitRowInput = {
  readonly state: string;
  readonly kind: UnitKind;
  /** The row as the listing holds it, for the proofs. */
  readonly listed: ParsedListingRow;
  readonly name: string;
  readonly parentKey: string | null;
  readonly website: { readonly url: string; readonly meta: FieldMetaRow } | null;
  readonly register: TimezoneRegister;
  readonly budget: {
    readonly cents: number;
    readonly year: number;
    readonly meta: FieldMetaRow;
  } | null;
  readonly label: readonly [number, number] | null;
  readonly checkedAt: string;
};

/** One unit's row, with the population of a general-purpose unit, its website, zone and budget. */
export function unitJurisdictionRow(input: UnitRowInput): BJurisdiction {
  const { listed } = input;
  const fieldMeta: FieldMetaMap = {};
  const population = listingPopulation(listed, input.checkedAt);
  if (population !== null) fieldMeta['population'] = population.meta;
  if (input.website !== null) fieldMeta['website'] = input.website.meta;
  const timezone = unitTimezone(input.register, input.state, {
    kind: input.kind,
    fips_state: listed.fips_state,
    fips_county: listed.fips_county,
  });
  const zoneMeta =
    timezone === null ? null : zoneProof(input.register, input.state, input.checkedAt);
  if (zoneMeta !== null) fieldMeta['timezone'] = zoneMeta;
  if (input.budget !== null) fieldMeta['budget_cents'] = input.budget.meta;
  return BJurisdictionSchema.parse({
    source_key: unitKey(listed.pid6),
    kind: input.kind,
    name: input.name,
    state: input.state,
    census_id: listed.pid6,
    parent_key: input.parentKey,
    population: population?.population ?? null,
    website: input.website?.url ?? null,
    timezone,
    budget_cents: input.budget?.cents ?? null,
    budget_year: input.budget?.year ?? null,
    census_active: listed.active,
    label_lng: input.label?.[0] ?? null,
    label_lat: input.label?.[1] ?? null,
    field_meta: fieldMeta,
  });
}

/** The state's own row: the TIGER STATE name, the ACS population and the default zone. */
export function stateJurisdictionRow(input: {
  readonly state: string;
  readonly name: string;
  readonly population: { readonly value: number; readonly meta: FieldMetaRow } | null;
  readonly register: TimezoneRegister;
  readonly label: readonly [number, number] | null;
  readonly checkedAt: string;
}): BJurisdiction {
  const fieldMeta: FieldMetaMap = {};
  if (input.population !== null) fieldMeta['population'] = input.population.meta;
  const timezone = zoneForState(input.register, input.state);
  const zoneMeta =
    timezone === null ? null : zoneProof(input.register, input.state, input.checkedAt);
  if (zoneMeta !== null) fieldMeta['timezone'] = zoneMeta;
  return BJurisdictionSchema.parse({
    source_key: stateKey(input.state),
    kind: 'state',
    name: input.name,
    state: input.state,
    census_id: null,
    parent_key: null,
    population: input.population?.value ?? null,
    website: null,
    timezone,
    budget_cents: null,
    budget_year: null,
    census_active: null,
    label_lng: input.label?.[0] ?? null,
    label_lat: input.label?.[1] ?? null,
    field_meta: fieldMeta,
  });
}
