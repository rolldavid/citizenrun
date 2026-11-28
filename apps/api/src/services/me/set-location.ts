import { users } from '@citizenrun/db';
import { ApiError, territoryAt } from '@citizenrun/shared';
import type { SetLocationBody, Territory } from '@citizenrun/shared';
import { eq, sql } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { flagsOf } from '../../deps.ts';
import type { Platform, Viewer } from '../../middleware/session.ts';
import { CensusUnavailableError, censusOf } from '../geo/census.ts';
import type { CensusMatch } from '../geo/census.ts';
import { coveredStatesOf } from '../geo/covered-states.ts';
import { advanceOnboarding } from './onboarding.ts';
import { resolveDistricts } from './resolve-districts.ts';
import type { ResolvedDistrict } from './resolve-districts.ts';

// A bare ZIP or ZIP+4 asks for a street address (E-ME-13 step 2).
const BARE_ZIP = /^[0-9]{5}(-[0-9]{4})?$/;

type LocatedPoint = {
  point: { lat: number; lng: number };
  precision: 'exact' | 'approx';
  census: CensusMatch | null;
};

// Step 2: the body's point, or the Census Geocoder's match of the typed address (D-211).
async function locate(deps: Deps, body: SetLocationBody): Promise<LocatedPoint> {
  const { address } = body;
  if (address === undefined) {
    const { lat, lng, precision } = body;
    if (lat === undefined || lng === undefined || precision === undefined) {
      // The body schema refuses this; a broken chain, never a caller's error.
      throw new Error('The location body holds neither a point nor an address.');
    }
    return { point: { lat, lng }, precision, census: null };
  }
  if (BARE_ZIP.test(address)) {
    throw new ApiError('need_street_address');
  }
  let result;
  try {
    result = await censusOf(deps).geocode(address);
  } catch (error) {
    // The error is never logged: only its class decides the answer.
    if (error instanceof CensusUnavailableError) {
      throw new ApiError('geocoder_unavailable');
    }
    throw error;
  }
  if (result.kind === 'no_match') {
    throw new ApiError('address_not_found');
  }
  const { match } = result;
  return { point: { lat: match.lat, lng: match.lng }, precision: 'exact', census: match };
}

// Step 5: the state of the exact `tiger:state:` district, else of any exact level-state district.
function matchedState(exact: readonly ResolvedDistrict[]): string | null {
  const stateLevel = exact.filter((district) => district.level === 'state');
  const tigerState = stateLevel.find((district) => district.sourceKey.startsWith('tiger:state:'));
  return (tigerState ?? stateLevel[0])?.state ?? null;
}

/**
 * E-ME-13: turns a point or a typed address into stored district ids (D-210, D-211, D-463).
 * Nothing is written until every check passes; the districts, `location_precision`, the cleared
 * stale mark and the onboarding step are written in one transaction. The point, the address, the
 * geocoder's answer and the district ids are never logged, stored elsewhere or sent anywhere but
 * the Census Geocoder. `platform` is the request's client platform, for the onboarding events
 * (L-app-events).
 */
export async function setLocation(
  deps: Deps,
  input: { viewer: Viewer; platform: Platform; body: SetLocationBody; now: Date },
): Promise<{
  outcome: 'matched' | 'not_covered_yet';
  territory: Territory | null;
  districtIds: string[];
  exactIds: string[];
}> {
  const { viewer, now } = input;
  const located = await locate(deps, input.body);

  // Step 3.
  const { districts, disagreements } = await resolveDistricts(deps.db, {
    point: located.point,
    census: located.census,
  });
  const log = deps.logger;
  for (const layer of disagreements) {
    log.info('geo.census_disagreement', { layer });
  }
  const exact = districts.filter((district) => !district.approximate);

  // Step 4: no state-level district means a territory with no offices, or outside the states.
  let outcome: 'matched' | 'not_covered_yet' = 'matched';
  let territory: Territory | null = null;
  if (!exact.some((district) => district.level === 'state')) {
    territory = territoryAt(located.point.lat, located.point.lng);
    if (territory === null || (await coveredStatesOf(deps).get(now)).has(territory)) {
      throw new ApiError('outside_us');
    }
    outcome = 'not_covered_yet';
  }

  // Step 5: the per-state rules, for a match only (L-age-consent).
  if (outcome === 'matched') {
    const state = matchedState(exact);
    const rule = state === null ? null : await flagsOf(deps).stateRule(state);
    if (rule?.signup === 'withhold') {
      throw new ApiError('unavailable_in_state');
    }
    if (rule?.ageMethod === 'store_signal_required') {
      const [row] = await deps.db
        .select({ ageMethod: users.ageMethod })
        .from(users)
        .where(eq(users.id, viewer.userId));
      if (row?.ageMethod !== 'store_signal') {
        throw new ApiError('age_signal_required');
      }
    }
  }

  const stored = outcome === 'matched' ? districts : [];
  const districtIds = stored.map((district) => district.id);
  const exactIds = stored
    .filter((district) => !district.approximate)
    .map((district) => district.id);

  // Step 6.
  await deps.db.transaction(async (tx) => {
    // index: user_districts_pkey
    await tx.execute(sql`delete from user_districts where user_id = ${viewer.userId}`);
    if (districtIds.length > 0) {
      await tx.execute(
        sql`insert into user_districts (user_id, district_id, created_at)
            select ${viewer.userId}::uuid, unnest(${sql.param(districtIds)}::uuid[]), ${now}::timestamptz
            on conflict do nothing`,
      );
    }
    await tx
      .update(users)
      .set({
        locationPrecision: outcome === 'matched' ? located.precision : null,
        districtsStaleAt: null,
      })
      .where(eq(users.id, viewer.userId));
    // A user at another step keeps it; the districts are still stored (L-onboarding).
    await advanceOnboarding(tx, {
      userId: viewer.userId,
      from: 'location',
      outcome: 'completed',
      platform: input.platform,
      now,
    });
  });

  return { outcome, territory, districtIds, exactIds };
}
