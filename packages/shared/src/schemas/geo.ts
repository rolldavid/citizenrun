import { z } from 'zod';
import {
  GEO_LABEL_MAX,
  GEO_QUERY_MAX,
  GEO_QUERY_MIN,
  GEO_SUGGESTIONS_MAX,
} from '../constants/geo.ts';

/** One address or place suggestion (GeoSuggestion). */
export const GeoSuggestionSchema = z
  .object({
    /** What the user sees. */
    label: z.string().min(1).max(GEO_LABEL_MAX),
    /** Degrees, rounded to 6 decimals; zod refuses NaN and the infinities. */
    lat: z.number(),
    lng: z.number(),
    /** `exact` only for a street-address result (L-geo-provider). */
    precision: z.enum(['exact', 'approx']),
    kind: z.enum(['address', 'city', 'county', 'township', 'zip']),
  })
  .meta({ id: 'GeoSuggestion' });

export type GeoSuggestion = z.infer<typeof GeoSuggestionSchema>;

/** The answer of E-GEO-01: never paged, so `nextCursor` is always null. */
export const GeoSuggestionsPageSchema = z
  .object({
    items: z.array(GeoSuggestionSchema).max(GEO_SUGGESTIONS_MAX),
    nextCursor: z.null(),
    /** The credit the client shows beside the list (D-212); null for places and for an empty list. */
    attribution: z.enum(['geoapify', 'mapbox']).nullable(),
  })
  .meta({ id: 'GeoSuggestionsPage' });

export type GeoSuggestionsPage = z.infer<typeof GeoSuggestionsPageSchema>;

/** The body of E-GEO-01: the typed text travels only here (INV-40). */
export const SuggestPlacesBodySchema = z
  .object({
    q: z.string().trim().min(GEO_QUERY_MIN).max(GEO_QUERY_MAX),
    /** `address`: the location field; `place`: Explore's jump. */
    kind: z.enum(['address', 'place']),
  })
  .meta({ id: 'SuggestPlacesBody' });

export type SuggestPlacesBody = z.infer<typeof SuggestPlacesBodySchema>;
