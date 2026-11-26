import { describe, expect, it } from 'vitest';
import { GeoSuggestionSchema, GeoSuggestionsPageSchema, SuggestPlacesBodySchema } from './geo.ts';
import type { GeoSuggestion } from './geo.ts';

function issuesOf(input: unknown): { path: string; code: string; origin: unknown }[] {
  return (SuggestPlacesBodySchema.safeParse(input).error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    origin: 'origin' in issue ? issue.origin : undefined,
  }));
}

const SUGGESTION: GeoSuggestion = {
  label: 'Fixture City, ZZ',
  lat: 30.004321,
  lng: -39.995678,
  precision: 'approx',
  kind: 'city',
};

describe('SuggestPlacesBody', () => {
  it('a two-character query is refused', () => {
    // A string `too_small` issue, which the router reports as the field code `too_short`.
    expect(issuesOf({ q: 'ab', kind: 'place' })).toEqual([
      { path: 'q', code: 'too_small', origin: 'string' },
    ]);
    expect(SuggestPlacesBodySchema.safeParse({ q: 'abc', kind: 'place' }).success).toBe(true);
  });

  it('a 101-character query is refused', () => {
    expect(issuesOf({ q: 'a'.repeat(101), kind: 'address' })).toEqual([
      { path: 'q', code: 'too_big', origin: 'string' },
    ]);
    const hundred = { q: 'a'.repeat(100), kind: 'address' };
    expect(SuggestPlacesBodySchema.safeParse(hundred).success).toBe(true);
  });

  it('the query is trimmed', () => {
    const parsed = SuggestPlacesBodySchema.parse({ q: '  Fixture City \n', kind: 'place' });
    expect(parsed.q).toBe('Fixture City');
    // The length rule reads the trimmed text.
    expect(issuesOf({ q: '   ab   ', kind: 'place' })).toEqual([
      { path: 'q', code: 'too_small', origin: 'string' },
    ]);
  });

  it('an unknown kind is refused', () => {
    expect(issuesOf({ q: 'Fixture', kind: 'zip' })).toEqual([
      { path: 'kind', code: 'invalid_value', origin: undefined },
    ]);
    expect(issuesOf({ q: 'Fixture' }).map((issue) => issue.path)).toEqual(['kind']);
  });
});

describe('GeoSuggestionsPage', () => {
  it('a page holds at most five items', () => {
    const page = (count: number) => ({
      items: Array.from({ length: count }, () => SUGGESTION),
      nextCursor: null,
      attribution: 'geoapify',
    });
    expect(GeoSuggestionsPageSchema.safeParse(page(5)).success).toBe(true);
    expect(GeoSuggestionsPageSchema.safeParse(page(6)).success).toBe(false);
  });

  it('the cursor is always null and the credit is one of two or none', () => {
    const base = { items: [], nextCursor: null, attribution: null };
    expect(GeoSuggestionsPageSchema.safeParse(base).success).toBe(true);
    expect(GeoSuggestionsPageSchema.safeParse({ ...base, nextCursor: 'x' }).success).toBe(false);
    const other = { ...base, attribution: 'other' };
    expect(GeoSuggestionsPageSchema.safeParse(other).success).toBe(false);
  });
});

describe('GeoSuggestion', () => {
  it('a label holds 1 to 200 characters', () => {
    const parses = (label: string) =>
      GeoSuggestionSchema.safeParse({ ...SUGGESTION, label }).success;
    expect(parses('a'.repeat(200))).toBe(true);
    expect(parses('a'.repeat(201))).toBe(false);
    expect(parses('')).toBe(false);
  });

  it('coordinates are finite numbers', () => {
    for (const lat of [Number.NaN, Number.POSITIVE_INFINITY, '30.1']) {
      expect(GeoSuggestionSchema.safeParse({ ...SUGGESTION, lat }).success).toBe(false);
    }
  });

  it('kind and precision take only their values', () => {
    expect(GeoSuggestionSchema.safeParse({ ...SUGGESTION, kind: 'state' }).success).toBe(false);
    const rough = { ...SUGGESTION, precision: 'rough' };
    expect(GeoSuggestionSchema.safeParse(rough).success).toBe(false);
  });
});
