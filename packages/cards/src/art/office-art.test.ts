import { describe, expect, it } from 'vitest';
import { OFFICE_TYPE_ILLUSTRATION } from '../generated/office-type-illustrations.ts';
import { hasOfficeType, illustrationFor } from './office-art.tsx';

describe('illustrationFor', () => {
  it('maps the shared drawings', () => {
    expect(illustrationFor('us-senate')).toBe('congress');
    expect(illustrationFor('us-house')).toBe('congress');
    expect(illustrationFor('state-senate')).toBe('legislature');
    expect(illustrationFor('state-house')).toBe('legislature');
    expect(illustrationFor('party-precinct-committee')).toBe('party-committee');
    expect(illustrationFor('party-committee')).toBe('party-committee');
    expect(illustrationFor('county-treasurer')).toBe('county-treasurer');
  });

  it('falls back to the city council for an unknown type', () => {
    expect(illustrationFor('not-a-type')).toBe('city-council');
    expect(illustrationFor('constructor')).toBe('city-council');
    expect(hasOfficeType('not-a-type')).toBe(false);
    expect(hasOfficeType('constructor')).toBe(false);
    expect(hasOfficeType('county-treasurer')).toBe(true);
  });

  it('the table has 42 types and 39 drawings', () => {
    expect(Object.keys(OFFICE_TYPE_ILLUSTRATION)).toHaveLength(42);
    expect(new Set(Object.values(OFFICE_TYPE_ILLUSTRATION)).size).toBe(39);
    expect(Object.values(OFFICE_TYPE_ILLUSTRATION)).toContain('city-council');
  });
});
