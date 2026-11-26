import {
  CENSUS_BREAKER_FAILURES,
  CENSUS_BREAKER_OPEN_MS,
  CENSUS_CALLS_PER_SECOND,
  CENSUS_LAYER_NAMES,
  CENSUS_RETRIES,
  CENSUS_TIMEOUT_MS,
} from '@citizenrun/shared';
import type { TigerLayer } from '@citizenrun/shared';
import { z } from 'zod';
import type { Deps } from '../../deps.ts';
import { OUTBOUND_HOSTS } from '../../lib/outbound-fetch.ts';
import type { OutboundFetch } from '../../lib/outbound-fetch.ts';

/** A matched address: its point and the GEOIDs of the layers this app reads. */
export type CensusMatch = {
  lat: number;
  lng: number;
  layers: ReadonlyArray<{ token: TigerLayer; geoid: string }>;
};
export type CensusResult = { kind: 'match'; match: CensusMatch } | { kind: 'no_match' };

/** Any failed lookup: the geocoder's, the open breaker's or the limiter's. The message is fixed. */
export class CensusUnavailableError extends Error {
  override readonly name = 'CensusUnavailableError';

  constructor() {
    super('The address lookup service is unavailable.');
  }
}

export type CensusGeocoder = { geocode(address: string): Promise<CensusResult> };

const GEOCODER_PATH = '/geocoder/geographies/onelineaddress';
const LIMITER_WINDOW_MS = 1_000; // D-211

// Only the fields read below. The answer echoes the typed address; the parse drops it and the body
// is never logged or kept.
const CensusAnswerSchema = z.object({
  result: z.object({
    addressMatches: z.array(
      z.object({
        coordinates: z.object({ x: z.number(), y: z.number() }),
        geographies: z.record(z.string(), z.array(z.object({ GEOID: z.string() }))),
      }),
    ),
  }),
});

type CensusAnswer = z.infer<typeof CensusAnswerSchema>;

function isLayerName(name: string): name is keyof typeof CENSUS_LAYER_NAMES {
  return Object.hasOwn(CENSUS_LAYER_NAMES, name);
}

function resultOf(answer: CensusAnswer): CensusResult {
  const first = answer.result.addressMatches[0];
  if (first === undefined) {
    return { kind: 'no_match' };
  }
  const layers: { token: TigerLayer; geoid: string }[] = [];
  for (const [name, entries] of Object.entries(first.geographies)) {
    // A layer of another name, such as a later Congress, is not used (D-211).
    const entry = entries[0];
    if (isLayerName(name) && entry !== undefined) {
      layers.push({ token: CENSUS_LAYER_NAMES[name], geoid: entry.GEOID });
    }
  }
  return {
    kind: 'match',
    match: { lat: first.coordinates.y, lng: first.coordinates.x, layers },
  };
}

// One attempt's outcome: an answer, a failure worth one retry, or a failure that is not retried.
type Attempt = { kind: 'answer'; result: CensusResult } | { kind: 'retry' } | { kind: 'final' };

/**
 * The keyless Census Geocoder (L-census-geocoder, D-211): a 5-second timeout per attempt, one
 * retry, a breaker that opens for 60 seconds after 5 failed calls in a row, and at most 5 attempts
 * started in any 1,000 ms. Every failure throws CensusUnavailableError; the original error, which
 * can quote the URL and so the address, is dropped.
 */
export function createCensusGeocoder(
  outbound: OutboundFetch,
  clock: { now(): Date },
): CensusGeocoder {
  let consecutiveFailures = 0;
  let openUntil = Number.NEGATIVE_INFINITY;
  const attemptStarts: number[] = [];

  // Takes a slot for one attempt now, or refuses when the window already holds five.
  function admit(): boolean {
    const now = clock.now().getTime();
    while (attemptStarts.length > 0 && (attemptStarts[0] ?? now) <= now - LIMITER_WINDOW_MS) {
      attemptStarts.shift();
    }
    if (attemptStarts.length >= CENSUS_CALLS_PER_SECOND) {
      return false;
    }
    attemptStarts.push(now);
    return true;
  }

  async function attempt(address: string): Promise<Attempt> {
    const query = new URLSearchParams({
      address,
      benchmark: 'Public_AR_Current',
      vintage: 'Current_Current',
      layers: 'all',
      format: 'json',
    });
    let response: Response;
    try {
      response = await outbound(OUTBOUND_HOSTS.census, `${GEOCODER_PATH}?${query.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(CENSUS_TIMEOUT_MS),
      });
    } catch {
      // A timeout or a network error.
      return { kind: 'retry' };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return response.status >= 500 ? { kind: 'retry' } : { kind: 'final' };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'retry' };
    }
    const parsed = CensusAnswerSchema.safeParse(body);
    return parsed.success ? { kind: 'answer', result: resultOf(parsed.data) } : { kind: 'retry' };
  }

  function fail(): never {
    consecutiveFailures += 1;
    if (consecutiveFailures >= CENSUS_BREAKER_FAILURES) {
      openUntil = clock.now().getTime() + CENSUS_BREAKER_OPEN_MS;
    }
    throw new CensusUnavailableError();
  }

  return {
    async geocode(address) {
      if (clock.now().getTime() < openUntil) {
        throw new CensusUnavailableError();
      }
      for (let tries = 0; tries <= CENSUS_RETRIES; tries += 1) {
        // A refusal by the limiter ends the call at once and is not counted by the breaker.
        if (!admit()) {
          throw new CensusUnavailableError();
        }
        const outcome = await attempt(address);
        if (outcome.kind === 'answer') {
          consecutiveFailures = 0;
          return outcome.result;
        }
        if (outcome.kind === 'final') {
          break;
        }
      }
      return fail();
    },
  };
}

// One geocoder per Deps: one breaker and one limiter per process, which is one replica.
const geocoders = new WeakMap<Deps, CensusGeocoder>();

/** The Census Geocoder of `deps`, made on first use and kept for the life of `deps`. */
export function censusOf(deps: Deps): CensusGeocoder {
  let geocoder = geocoders.get(deps);
  if (geocoder === undefined) {
    geocoder = createCensusGeocoder(deps.outbound, deps.clock);
    geocoders.set(deps, geocoder);
  }
  return geocoder;
}
