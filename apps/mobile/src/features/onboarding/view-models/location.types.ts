import type { ErrorCode } from '@citizenrun/shared';

// SCR-onboarding-location
export type OnboardingLocationSoonViewModel = {
  skipStatus: 'idle' | 'sending';
  errorCode: ErrorCode | null;
  offline: boolean;
  onSkip: () => void; // the footer's "Continue": E-ME-10 { step: 'location' }
  onBack: () => void;
};
