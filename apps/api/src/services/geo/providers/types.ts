import type { GeoSuggestion } from '@citizenrun/shared';

/** The address-suggestion provider, chosen once per process from the environment (L-geo-provider). */
export interface AddressSuggestProvider {
  readonly name: 'geoapify' | 'none';
  /** Up to `limit` United States address suggestions for `q`. Sends no user identifier. Rejects on timeout or a non-2xx answer. */
  suggest(q: string, opts: { limit: number; signal: AbortSignal }): Promise<GeoSuggestion[]>;
}
