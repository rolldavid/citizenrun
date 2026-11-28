import type { AgeAssurance, AgeOutcome } from '@/platform/age-assurance/types';

export type AgeAssuranceFakeCall =
  { op: 'requestStoreSignal' } | { op: 'acknowledgeSignificantUpdate' };

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
  /** Restores the defaults. */
  reset: (): void => {
    calls.length = 0;
    state.storeSignalSupported = true;
    state.outcome = DEFAULT_OUTCOME;
    state.acknowledgmentRequired = false;
  },
};
