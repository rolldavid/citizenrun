import { GEO_LABEL_MAX, roundHalfAwayFromZero } from '@citizenrun/shared';
import type { GeoSuggestion } from '@citizenrun/shared';
import { z } from 'zod';
import { OUTBOUND_HOSTS } from '../../../lib/outbound-fetch.ts';
import type { OutboundFetch } from '../../../lib/outbound-fetch.ts';
import type { AddressSuggestProvider } from './types.ts';

const AUTOCOMPLETE_PATH = '/v1/geocode/autocomplete';
// The provider always gets the most it may return; the caller's limit cuts the answer.
const PROVIDER_LIMIT = '5'; // L-geo-provider
const COORDINATE_DECIMALS = 6; // GeoSuggestion

/** A failed suggestion request. The message is fixed: the provider's own text is never kept. */
export class GeoProviderError extends Error {
  override readonly name = 'GeoProviderError';

  constructor() {
    super('Address suggestions failed.');
  }
}

// Only the fields the mapping reads; everything else in the answer is dropped by the parse.
const AutocompleteAnswerSchema = z.object({
  results: z.array(
    z.object({
      formatted: z.string().optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      country_code: z.string().optional(),
      result_type: z.string().optional(),
    }),
  ),
});

type AutocompleteResult = z.infer<typeof AutocompleteAnswerSchema>['results'][number];

function suggestionOf(result: AutocompleteResult): GeoSuggestion | null {
  const { formatted, lat, lon } = result;
  if (
    result.country_code !== 'us' ||
    formatted === undefined ||
    formatted === '' ||
    lat === undefined ||
    lon === undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null;
  }
  return {
    label: formatted.slice(0, GEO_LABEL_MAX),
    lat: roundHalfAwayFromZero(lat, COORDINATE_DECIMALS),
    lng: roundHalfAwayFromZero(lon, COORDINATE_DECIMALS),
    precision: result.result_type === 'building' ? 'exact' : 'approx',
    kind: 'address',
  };
}

/**
 * Geoapify's address autocomplete through `outbound` (D-057, D-212): one GET carrying only the typed
 * text, the United States filter, the limit, the format and the key (INV-27). No retry: a 429 from
 * the provider is a failure like any other.
 */
export function createGeoapifyProvider(
  outbound: OutboundFetch,
  apiKey: string,
): AddressSuggestProvider {
  return Object.freeze({
    name: 'geoapify',
    async suggest(q: string, opts: { limit: number; signal: AbortSignal }) {
      const query = new URLSearchParams({
        text: q,
        filter: 'countrycode:us',
        limit: PROVIDER_LIMIT,
        format: 'json',
        apiKey,
      });
      // The request's own error can quote the URL, which holds the text and the key: it is
      // replaced, never wrapped.
      let body: unknown;
      try {
        const response = await outbound(
          OUTBOUND_HOSTS.geoapify,
          `${AUTOCOMPLETE_PATH}?${query.toString()}`,
          { method: 'GET', signal: opts.signal },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new GeoProviderError();
        }
        body = await response.json();
      } catch {
        throw new GeoProviderError();
      }
      const parsed = AutocompleteAnswerSchema.safeParse(body);
      if (!parsed.success) {
        throw new GeoProviderError();
      }
      const suggestions: GeoSuggestion[] = [];
      for (const result of parsed.data.results) {
        if (suggestions.length >= opts.limit) {
          break;
        }
        const suggestion = suggestionOf(result);
        if (suggestion !== null) {
          suggestions.push(suggestion);
        }
      }
      return suggestions;
    },
  });
}
