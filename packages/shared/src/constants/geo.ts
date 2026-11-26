import type { TigerLayer } from '../bundle/keys.ts';

/**
 * The 56 state-level codes with a per-state rules row: the 50 states, then DC, PR, GU, VI, AS and MP,
 * in the order the rules table is seeded (D-530).
 */
export const STATE_CODES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
  'PR',
  'GU',
  'VI',
  'AS',
  'MP',
] as const;

export type StateCode = (typeof STATE_CODES)[number];

export const GEO_QUERY_MIN = 3; // L-geo-constants
export const GEO_QUERY_MAX = 100; // L-geo-constants
export const GEO_SUGGESTIONS_MAX = 5; // L-geo-constants
/** The longest label a suggestion carries, in characters. */
export const GEO_LABEL_MAX = 200; // GeoSuggestion
export const GEO_SUGGEST_PER_MINUTE = 30; // L-geo-constants, R-140
export const GEO_SUGGEST_PER_DAY = 150; // L-geo-constants, R-140
/** Past this share of GEO_MONTHLY_CAP, only sessions still in sign-up get address suggestions. */
export const GEO_SIGNUP_ONLY_FRACTION = 0.8; // L-geo-constants, R-140
export const GEO_PROVIDER_TIMEOUT_MS = 2_000; // L-geo-constants, CTL-37
export const LOCATION_UPDATES_PER_DAY = 20; // L-geo-constants, R-140
export const CENSUS_TIMEOUT_MS = 5_000; // D-211
export const CENSUS_RETRIES = 1; // D-211
export const CENSUS_BREAKER_FAILURES = 5; // D-211
export const CENSUS_BREAKER_OPEN_MS = 60_000; // D-211
/** Attempts started in any 1,000 ms, per replica. */
export const CENSUS_CALLS_PER_SECOND = 5; // D-211
export const COVERED_STATES_CACHE_MS = 300_000; // L-geo-constants

/**
 * The Census Geocoder's layer names this app reads, each to its boundary layer token. A layer whose
 * name differs, such as a later Congress, is not used.
 */
export const CENSUS_LAYER_NAMES = {
  States: 'state',
  Counties: 'county',
  'County Subdivisions': 'cousub',
  'Incorporated Places': 'place',
  'Census Designated Places': 'place',
  '120th Congressional Districts': 'cd',
  '2026 State Legislative Districts - Upper': 'sldu',
  '2026 State Legislative Districts - Lower': 'sldl',
  'Unified School Districts': 'unsd',
} as const satisfies Record<string, TigerLayer>; // L-geo-constants, D-209, D-211

/** The five inhabited territories. */
export type Territory = 'PR' | 'GU' | 'VI' | 'AS' | 'MP';

/** A box in degrees: west, south, east, north. */
export type GeoBounds = readonly [west: number, south: number, east: number, north: number];

/** A padded box around each territory, in the order `territoryAt` reads them. */
export const TERRITORY_BOUNDS: Readonly<Record<Territory, GeoBounds>> = Object.freeze({
  PR: [-68.0, 17.8, -65.1, 18.6],
  VI: [-65.2, 17.6, -64.5, 18.5],
  GU: [144.5, 13.1, 145.1, 13.8],
  AS: [-171.2, -14.7, -168.0, -10.9],
  MP: [144.8, 14.0, 146.2, 20.7],
} as const); // L-geo-constants

const TERRITORY_ORDER: readonly Territory[] = ['PR', 'VI', 'GU', 'AS', 'MP'];

/** The territory of the first box that holds the point, edges included, or null. */
export function territoryAt(lat: number, lng: number): Territory | null {
  for (const territory of TERRITORY_ORDER) {
    const [west, south, east, north] = TERRITORY_BOUNDS[territory];
    if (lng >= west && lng <= east && lat >= south && lat <= north) {
      return territory;
    }
  }
  return null;
}
