import { addUsage, dayPeriod, monthPeriod } from '@citizenrun/db';
import {
  GEO_PROVIDER_TIMEOUT_MS,
  GEO_SIGNUP_ONLY_FRACTION,
  GEO_SUGGESTIONS_MAX,
} from '@citizenrun/shared';
import type { GeoSuggestion, GeoSuggestionsPage, OnboardingStep } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { coveredStatesOf } from './covered-states.ts';
import { searchPlaces } from './place-search.ts';
import { providerOf } from './providers/index.ts';

const EMPTY: GeoSuggestionsPage = Object.freeze({
  items: [],
  nextCursor: null,
  attribution: null,
});

// The month's count of requests sent to the provider, read without changing it (0 when absent).
async function monthCount(deps: Deps, now: Date): Promise<number> {
  // index: usage_counters_pkey
  const rows = await deps.db.execute<{ count: string | number }>(
    sql`select count from usage_counters where name = 'geo.month' and period = ${monthPeriod(now)}`,
    'objects',
  );
  const count = rows[0]?.count;
  return count === undefined ? 0 : Number(count);
}

async function suggestAddresses(
  deps: Deps,
  input: { q: string; onboardingStep: OnboardingStep; now: Date },
): Promise<GeoSuggestionsPage> {
  const provider = providerOf(deps);
  if (provider.name === 'none') {
    return EMPTY;
  }
  const { GEO_MONTHLY_CAP, GEO_DAILY_CAP } = deps.env;
  // CTL-54: past 80 percent of the month's cap, only sessions still in sign-up get suggestions.
  if (
    input.onboardingStep === 'done' &&
    (await monthCount(deps, input.now)) >= GEO_SIGNUP_ONLY_FRACTION * GEO_MONTHLY_CAP
  ) {
    return EMPTY;
  }
  // D-212: the caps count requests sent, so both counters move before the call.
  const month = await addUsage(deps.db, 'geo.month', monthPeriod(input.now), 1);
  const day = await addUsage(deps.db, 'geo.day', dayPeriod(input.now), 1);
  if (month > GEO_MONTHLY_CAP || day > GEO_DAILY_CAP) {
    return EMPTY;
  }
  let items: GeoSuggestion[];
  try {
    items = await provider.suggest(input.q, {
      limit: GEO_SUGGESTIONS_MAX,
      signal: AbortSignal.timeout(GEO_PROVIDER_TIMEOUT_MS),
    });
  } catch {
    // No value of the request or of the provider's answer is logged (INV-40).
    const log = deps.logger;
    log.warn('geo.provider_failed');
    return EMPTY;
  }
  const kept = items.slice(0, GEO_SUGGESTIONS_MAX);
  // Nothing to credit beside an empty list (E-GEO-01 step 5).
  return kept.length === 0 ? EMPTY : { items: kept, nextCursor: null, attribution: 'geoapify' };
}

/**
 * E-GEO-01: place search from our own tables, or address suggestions from the provider within the
 * caps (D-212, CTL-54). A cap, a provider failure or no provider answers an empty list,
 * never an error. `q`, the suggestions and the provider's answer are never logged or stored.
 */
export async function suggestPlaces(
  deps: Deps,
  input: { q: string; kind: 'address' | 'place'; onboardingStep: OnboardingStep; now: Date },
): Promise<GeoSuggestionsPage> {
  if (input.kind === 'place') {
    const covered = await coveredStatesOf(deps).get(input.now);
    const items = await searchPlaces(deps.db, { q: input.q, covered });
    return { items, nextCursor: null, attribution: null };
  }
  return suggestAddresses(deps, input);
}
