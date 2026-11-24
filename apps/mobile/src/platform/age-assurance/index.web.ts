import { PlatformNotReadyError } from '@/platform/shared';
import type { AgeAssurance } from './types';

export const ageAssurance: AgeAssurance = {
  storeSignalSupported: false,
  requestStoreSignal: () =>
    Promise.reject(new PlatformNotReadyError('age_assurance', 'requestStoreSignal')),
  significantUpdateAcknowledgmentRequired: () =>
    Promise.reject(
      new PlatformNotReadyError('age_assurance', 'significantUpdateAcknowledgmentRequired'),
    ),
  acknowledgeSignificantUpdate: () =>
    Promise.reject(new PlatformNotReadyError('age_assurance', 'acknowledgeSignificantUpdate')),
  evaluateBirthMonth: () => {
    throw new PlatformNotReadyError('age_assurance', 'evaluateBirthMonth');
  },
  gateBlockedUntil: () => {
    throw new PlatformNotReadyError('age_assurance', 'gateBlockedUntil');
  },
  blockGate: () => {
    throw new PlatformNotReadyError('age_assurance', 'blockGate');
  },
};

export type * from './types';
