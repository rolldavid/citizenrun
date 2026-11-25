import { blockedUntilFrom, evaluateBirthMonth } from '@/platform/age-assurance/dob-gate';
import type { AgeAssurance, AgeOutcome } from '@/platform/age-assurance/types';

import { storage } from './storage';

/** Never a birth month: the gate's answer and its lock are the only things a test can see. */
export type AgeAssuranceFakeCall =
  { op: 'requestStoreSignal' } | { op: 'blockGate' } | { op: 'acknowledgeSignificantUpdate' };

const DEFAULT_OUTCOME: AgeOutcome = { kind: 'adult', tier: 'declared' };

const calls: AgeAssuranceFakeCall[] = [];
const state: {
  storeSignalSupported: boolean;
  outcome: AgeOutcome;
  acknowledgmentRequired: boolean;
} = {
  storeSignalSupported: true,
  outcome: DEFAULT_OUTCOME,
  acknowledgmentRequired: false,
};

// The real gate function; the lock lives in the storage fake under 'ageGate.blockedUntil'.
export const ageAssurance: AgeAssurance = {
  get storeSignalSupported() {
    return state.storeSignalSupported;
  },
  requestStoreSignal: () => {
    calls.push({ op: 'requestStoreSignal' });
    return Promise.resolve(state.outcome);
  },
  significantUpdateAcknowledgmentRequired: () => Promise.resolve(state.acknowledgmentRequired),
  acknowledgeSignificantUpdate: () => {
    calls.push({ op: 'acknowledgeSignificantUpdate' });
    return Promise.resolve();
  },
  evaluateBirthMonth,
  gateBlockedUntil: () => storage.get('ageGate.blockedUntil'),
  blockGate: (now) => {
    calls.push({ op: 'blockGate' });
    storage.set('ageGate.blockedUntil', blockedUntilFrom(now));
  },
};

function scriptSignal(outcome: AgeOutcome): void {
  state.outcome = outcome;
}

export const ageAssuranceFake = {
  calls: calls as readonly AgeAssuranceFakeCall[],
  /** The outcome requestStoreSignal() answers. */
  scriptSignal,
  /** The same as scriptSignal. */
  scriptOutcome: scriptSignal,
  setStoreSignalSupported: (value: boolean): void => {
    state.storeSignalSupported = value;
  },
  scriptAcknowledgmentRequired: (value: boolean): void => {
    state.acknowledgmentRequired = value;
  },
  /** Restores the defaults. The gate lock is the storage fake's, which its own reset() clears. */
  reset: (): void => {
    calls.length = 0;
    state.storeSignalSupported = true;
    state.outcome = DEFAULT_OUTCOME;
    state.acknowledgmentRequired = false;
  },
};
