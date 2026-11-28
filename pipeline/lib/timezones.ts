// The IANA zone of a state, county, unit or co-op from data/timezones.yaml (PIPE-timezones).
// A state with no entry gives null; the days-left function then uses its own fallback.
import type { FieldMetaRow } from '@citizenrun/shared';
import { loadTimezones } from './data-files.ts';
import type { TimezoneEntry } from './data-files.ts';
import { dataDir } from './paths.ts';

export type TimezoneRegister = ReadonlyMap<string, TimezoneEntry>;

/** The data/sources.yaml dataset the register is authored from (49 CFR Part 71). */
export const TIMEZONE_DATASET = 'ecfr-time-zones';

/** The register keyed by state. */
export function timezoneRegister(entries: readonly TimezoneEntry[]): TimezoneRegister {
  return new Map(entries.map((entry) => [entry.state, entry]));
}

export async function loadTimezoneRegister(dir: string = dataDir()): Promise<TimezoneRegister> {
  return timezoneRegister(await loadTimezones(dir));
}

/** The state's default zone, or null when the state has no entry. */
export function zoneForState(reg: TimezoneRegister, state: string): string | null {
  return reg.get(state)?.default ?? null;
}

/** The county's override, else the state's default; null when the state has no entry. */
export function zoneForCounty(
  reg: TimezoneRegister,
  state: string,
  countyGeoid: string,
): string | null {
  const entry = reg.get(state);
  if (entry === undefined) {
    return null;
  }
  const override = entry.county_overrides.find((row) => row.county_geoid === countyGeoid);
  return override?.zone ?? entry.default;
}

/** A unit takes the zone of its county, `fipsState + fipsCounty`. */
export function zoneForUnit(
  reg: TimezoneRegister,
  state: string,
  fipsState: string,
  fipsCounty: string,
): string | null {
  return zoneForCounty(reg, state, `${fipsState}${fipsCounty}`);
}

/**
 * A co-op takes the zone of its most populous served county (a null population counts as 0; a tie
 * goes to the smaller GEOID). A co-op with no served county gets null.
 */
export function zoneForCoop(
  reg: TimezoneRegister,
  state: string,
  servedCounties: readonly { geoid: string; population: number | null }[],
): string | null {
  let best: { geoid: string; population: number } | null = null;
  for (const county of servedCounties) {
    const population = county.population ?? 0;
    if (
      best === null ||
      population > best.population ||
      (population === best.population && county.geoid < best.geoid)
    ) {
      best = { geoid: county.geoid, population };
    }
  }
  return best === null ? null : zoneForCounty(reg, state, best.geoid);
}

/** The proof of a zone taken from the state's entry, or null when the state has no entry. */
export function zoneProof(
  reg: TimezoneRegister,
  state: string,
  checkedAt: string,
): FieldMetaRow | null {
  const entry = reg.get(state);
  if (entry === undefined) {
    return null;
  }
  return {
    source_url: entry.source_url,
    quote: entry.quote,
    confidence: 'medium',
    checked_at: checkedAt,
    rule_citation: entry.citation,
  };
}
