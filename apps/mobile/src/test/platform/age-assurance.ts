import { PlatformNotReadyError } from '@/platform/shared';
import type { AgeAssurance, AgeOutcome } from '@/platform/age-assurance/types';

export type AgeAssuranceFakeCall =
  { op: 'requestStoreSignal' } | { op: 'blockGate' } | { op: 'acknowledgeSignificantUpdate' };

const GATE_LOCK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OUTCOME: AgeOutcome = { kind: 'adult', tier: 'declared' };

const calls: AgeAssuranceFakeCall[] = [];
const state: {
  storeSignalSupported: boolean;
  outcome: AgeOutcome;
  acknowledgmentRequired: boolean;
  blockedUntil: string | null;
} = {
  storeSignalSupported: true,
  outcome: DEFAULT_OUTCOME,
  acknowledgmentRequired: false,
  blockedUntil: null,
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
  evaluateBirthMonth: () => {
    throw new PlatformNotReadyError('age_assurance', 'evaluateBirthMonth');
  },
  gateBlockedUntil: () => state.blockedUntil,
  blockGate: (now) => {
    calls.push({ op: 'blockGate' });
    state.blockedUntil = new Date(now.getTime() + GATE_LOCK_MS).toISOString();
  },
};

export const ageAssuranceFake = {
  calls: calls as readonly AgeAssuranceFakeCall[],
  scriptOutcome: (outcome: AgeOutcome): void => {
    state.outcome = outcome;
  },
  setStoreSignalSupported: (value: boolean): void => {
    state.storeSignalSupported = value;
  },
  scriptAcknowledgmentRequired: (value: boolean): void => {
    state.acknowledgmentRequired = value;
  },
  reset: (): void => {
    calls.length = 0;
    state.storeSignalSupported = true;
    state.outcome = DEFAULT_OUTCOME;
    state.acknowledgmentRequired = false;
    state.blockedUntil = null;
  },
};
