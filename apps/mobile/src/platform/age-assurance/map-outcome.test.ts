import { describe, expect, it } from 'vitest';

import { mapAgeOutcome } from './map-outcome';
import type { StoreAgeResult } from './map-outcome';

// Fixture results in the shapes expo-age-range 58.0.3 documents for a single threshold of 18.
type Declaration = NonNullable<StoreAgeResult['ageRangeDeclaration']> | null;
type Source = NonNullable<StoreAgeResult['ageRangeSource']> | null;

function ios(
  ageRangeDeclaration: Declaration,
  lowerBound: number | null,
  upperBound: number | null,
): StoreAgeResult {
  return { lowerBound, upperBound, ageRangeDeclaration };
}

function android(
  ageRangeSource: Source,
  lowerBound: number | null,
  upperBound: number | null,
): StoreAgeResult {
  return { lowerBound, upperBound, ageRangeSource };
}

const ADULT = { lower: 18, upper: null } as const;
const MINOR = { lower: 0, upper: 17 } as const;

describe('mapAgeOutcome: iOS ageRangeDeclaration', () => {
  it('a confirmed result of 18 and over is an adult with tier confirmed', () => {
    expect(mapAgeOutcome(ios('confirmed', ADULT.lower, ADULT.upper))).toEqual({
      kind: 'adult',
      tier: 'confirmed',
    });
  });

  it('a confirmed result under 18 is a minor with tier confirmed', () => {
    expect(mapAgeOutcome(ios('confirmed', MINOR.lower, MINOR.upper))).toEqual({
      kind: 'minor',
      tier: 'confirmed',
      under13: false,
    });
  });

  it('a selfDeclared result of 18 and over is an adult with tier declared', () => {
    expect(mapAgeOutcome(ios('selfDeclared', ADULT.lower, ADULT.upper))).toEqual({
      kind: 'adult',
      tier: 'declared',
    });
  });

  it('a selfDeclared result under 18 is a minor with tier declared', () => {
    expect(mapAgeOutcome(ios('selfDeclared', MINOR.lower, MINOR.upper))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: false,
    });
  });

  it('a guardianDeclared result of 18 and over is an adult with tier declared', () => {
    expect(mapAgeOutcome(ios('guardianDeclared', ADULT.lower, ADULT.upper))).toEqual({
      kind: 'adult',
      tier: 'declared',
    });
  });

  it('a guardianDeclared result under 18 is a minor with tier declared', () => {
    expect(mapAgeOutcome(ios('guardianDeclared', MINOR.lower, MINOR.upper))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: false,
    });
  });

  it('a null ageRangeDeclaration is unavailable', () => {
    expect(mapAgeOutcome(ios(null, ADULT.lower, ADULT.upper))).toEqual({ kind: 'unavailable' });
    expect(mapAgeOutcome(ios(null, MINOR.lower, MINOR.upper))).toEqual({ kind: 'unavailable' });
  });
});

describe('mapAgeOutcome: Android ageRangeSource', () => {
  it('a TIER_A result of 18 and over is an adult with tier declared', () => {
    expect(mapAgeOutcome(android('TIER_A', ADULT.lower, ADULT.upper))).toEqual({
      kind: 'adult',
      tier: 'declared',
    });
  });

  it('a TIER_B result under 18 is a minor with tier declared', () => {
    expect(mapAgeOutcome(android('TIER_B', 13, 15))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: false,
    });
  });

  it('a TIER_B result of 18 and over is an adult with tier declared', () => {
    expect(mapAgeOutcome(android('TIER_B', ADULT.lower, ADULT.upper))).toEqual({
      kind: 'adult',
      tier: 'declared',
    });
  });

  it('a TIER_C result of 18 and over is an adult with tier confirmed', () => {
    expect(mapAgeOutcome(android('TIER_C', ADULT.lower, ADULT.upper))).toEqual({
      kind: 'adult',
      tier: 'confirmed',
    });
  });

  it('a TIER_D result of 18 and over is an adult with tier confirmed', () => {
    expect(mapAgeOutcome(android('TIER_D', ADULT.lower, ADULT.upper))).toEqual({
      kind: 'adult',
      tier: 'confirmed',
    });
  });

  it('a TIER_D result under 18 is a minor with tier confirmed', () => {
    expect(mapAgeOutcome(android('TIER_D', 16, 17))).toEqual({
      kind: 'minor',
      tier: 'confirmed',
      under13: false,
    });
  });

  it('a null ageRangeSource is unavailable', () => {
    // Play Age Signals reports every field as null unless the access status is SHARED
    expect(mapAgeOutcome(android(null, null, null))).toEqual({ kind: 'unavailable' });
    expect(mapAgeOutcome(android(null, ADULT.lower, ADULT.upper))).toEqual({ kind: 'unavailable' });
  });
});

describe('mapAgeOutcome: bounds', () => {
  it('an upper bound of 12 is a minor under 13', () => {
    expect(mapAgeOutcome(android('TIER_B', 0, 12))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: true,
    });
    expect(mapAgeOutcome(ios('guardianDeclared', null, 12))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: true,
    });
  });

  it('an upper bound of 15 is a minor not under 13', () => {
    expect(mapAgeOutcome(android('TIER_B', 13, 15))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: false,
    });
  });

  it('an upper bound of 13 is not under 13', () => {
    expect(mapAgeOutcome(ios('selfDeclared', 0, 13))).toMatchObject({
      kind: 'minor',
      under13: false,
    });
  });

  it('a missing upper bound is not under 13', () => {
    // a minor needs a known upper bound below 18, so a missing one never reads as under 13
    expect(mapAgeOutcome(ios('selfDeclared', 0, null))).toEqual({ kind: 'unavailable' });
    expect(mapAgeOutcome(ios('selfDeclared', 0, 17))).toMatchObject({ under13: false });
  });

  it('a lower bound of 17 with no upper bound is unavailable', () => {
    expect(mapAgeOutcome(ios('selfDeclared', 17, null))).toEqual({ kind: 'unavailable' });
  });

  it('a range that contradicts itself is unavailable', () => {
    expect(mapAgeOutcome(ios('confirmed', 18, 12))).toEqual({ kind: 'unavailable' });
  });

  it('a bound that is not a finite number is ignored', () => {
    const odd = {
      lowerBound: Number.NaN,
      upperBound: null,
      ageRangeDeclaration: 'confirmed',
    } as const;
    expect(mapAgeOutcome(odd)).toEqual({ kind: 'unavailable' });
  });
});

describe('mapAgeOutcome: no signal', () => {
  it('null is unavailable', () => {
    expect(mapAgeOutcome(null)).toEqual({ kind: 'unavailable' });
  });

  it('a default lower bound of 18 with no store declaration is unavailable', () => {
    // the library's answer on iOS before 26 and on the web
    expect(mapAgeOutcome({ lowerBound: 18, upperBound: null })).toEqual({ kind: 'unavailable' });
  });

  it('an unknown declaration value is declared', () => {
    const future = {
      lowerBound: 18,
      upperBound: null,
      ageRangeDeclaration: 'parentConfirmed' as unknown as Declaration,
    };
    expect(mapAgeOutcome(future)).toEqual({ kind: 'adult', tier: 'declared' });
    const futureSource = {
      lowerBound: 0,
      upperBound: 12,
      ageRangeSource: 'TIER_E' as unknown as Source,
    };
    expect(mapAgeOutcome(futureSource)).toEqual({ kind: 'minor', tier: 'declared', under13: true });
  });
});
