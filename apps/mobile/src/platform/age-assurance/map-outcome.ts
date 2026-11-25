import type { AgeRangeResponse } from 'expo-age-range';

import type { AgeOutcome } from './types';

/** The store's answer as the library returns it, narrowed to what the mapping reads. */
export type StoreAgeResult = Pick<
  AgeRangeResponse,
  'lowerBound' | 'upperBound' | 'ageRangeDeclaration' | 'ageRangeSource'
>;

type Tier = 'confirmed' | 'declared';

const ADULT_AGE = 18;
const CHILD_AGE = 13;

/**
 * The store's declaration values the library documents. iOS reports `ageRangeDeclaration`; Android reports
 * `ageRangeSource`. Confirmed or verified by the store is `confirmed`; declared by the person or a guardian is
 * `declared`.
 */
const DECLARATION_TIERS: Readonly<Record<string, Tier>> = {
  selfDeclared: 'declared',
  guardianDeclared: 'declared',
  confirmed: 'confirmed',
  TIER_A: 'declared', // the person declared their age
  TIER_B: 'declared', // a parent or guardian manages the age
  TIER_C: 'confirmed', // assessed by a card, an email address, a selfie, an ID or a tax ID
  TIER_D: 'confirmed', // a government ID with a selfie, or a digital ID
};

/** The tier of the store's declaration, or null when the result carries none (the store did not answer). */
function tierOf(result: StoreAgeResult): Tier | null {
  const declaration: unknown = result.ageRangeDeclaration ?? result.ageRangeSource ?? null;
  if (declaration === null || declaration === undefined) {
    return null;
  }
  if (typeof declaration === 'string' && Object.hasOwn(DECLARATION_TIERS, declaration)) {
    return DECLARATION_TIERS[declaration] ?? 'declared';
  }
  return 'declared'; // a value the module does not recognise is the least assurance
}

function boundOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The store's answer as an AgeOutcome (CTL-75). A result with no store declaration is `unavailable` even with
 * a lower bound of 18: the library answers `lowerBound: 18` where it is not supported, and a missing signal
 * never becomes an adult. Nothing of the result is kept (D-350).
 */
export function mapAgeOutcome(result: StoreAgeResult | null): AgeOutcome {
  if (result === null) {
    return { kind: 'unavailable' };
  }
  const tier = tierOf(result);
  if (tier === null) {
    return { kind: 'unavailable' };
  }
  const lower = boundOf(result.lowerBound);
  const upper = boundOf(result.upperBound);
  const adult = lower !== null && lower >= ADULT_AGE;
  const minor = upper !== null && upper < ADULT_AGE;
  if (adult === minor) {
    return { kind: 'unavailable' }; // no range, or one that contradicts itself
  }
  if (adult) {
    return { kind: 'adult', tier };
  }
  return { kind: 'minor', tier, under13: upper !== null && upper < CHILD_AGE };
}
