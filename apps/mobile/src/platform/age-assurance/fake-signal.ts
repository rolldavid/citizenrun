import type { AgeOutcome } from './types';

/** The values of the development fake signal (PM-age-assurance, D-552). */
export type FakeAgeSignal = 'adult' | 'adult_confirmed' | 'minor' | 'minor_under13' | 'unavailable';

const FAKE_OUTCOMES: Readonly<Record<FakeAgeSignal, AgeOutcome>> = {
  adult: { kind: 'adult', tier: 'declared' },
  adult_confirmed: { kind: 'adult', tier: 'confirmed' },
  minor: { kind: 'minor', tier: 'declared', under13: false },
  minor_under13: { kind: 'minor', tier: 'declared', under13: true },
  unavailable: { kind: 'unavailable' },
};

function isFakeAgeSignal(value: string): value is FakeAgeSignal {
  return Object.hasOwn(FAKE_OUTCOMES, value);
}

/** The outcome a development build fakes from the initial deep link's `fakeAgeSignal` query value, or null. */
export function fakeOutcomeFromUrl(url: string | null): AgeOutcome | null {
  if (url === null) {
    return null;
  }
  let value: string | null;
  try {
    value = new URL(url).searchParams.get('fakeAgeSignal');
  } catch {
    return null;
  }
  if (value === null || !isFakeAgeSignal(value)) {
    return null;
  }
  return FAKE_OUTCOMES[value];
}
