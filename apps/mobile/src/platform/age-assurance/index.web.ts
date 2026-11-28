import type { AgeAssurance } from './types';

// The web has no store signal: sign-up goes on without one and asks nothing (PM-age-assurance, D-897).
export const ageAssurance: AgeAssurance = {
  storeSignalSupported: false,
  requestStoreSignal: () => Promise.resolve({ kind: 'unavailable' }),
  significantUpdateAcknowledgmentRequired: () => Promise.resolve(false),
  acknowledgeSignificantUpdate: () => Promise.resolve(),
};

export type * from './types';
