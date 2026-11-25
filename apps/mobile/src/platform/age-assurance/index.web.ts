import { storage } from '@/platform/storage';

import { blockedUntilFrom, evaluateBirthMonth } from './dob-gate';
import type { AgeAssurance } from './types';

// The web has no store signal: sign-up always uses the month-and-year gate (PM-age-assurance).
export const ageAssurance: AgeAssurance = {
  storeSignalSupported: false,
  requestStoreSignal: () => Promise.resolve({ kind: 'unavailable' }),
  significantUpdateAcknowledgmentRequired: () => Promise.resolve(false),
  acknowledgeSignificantUpdate: () => Promise.resolve(),
  evaluateBirthMonth,
  gateBlockedUntil: () => storage.get('ageGate.blockedUntil'),
  blockGate: (now) => {
    storage.set('ageGate.blockedUntil', blockedUntilFrom(now));
  },
};

export type * from './types';
