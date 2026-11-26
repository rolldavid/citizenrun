import type { ErrorCode } from '@citizenrun/shared';

/** SCR-onboarding-handle (PC6B-18, D-570). */
export type OnboardingHandleViewModel = {
  initialHandle: string | null; // me.handle when the person came back to this step
  check: 'idle' | 'checking' | 'free' | 'taken' | 'reserved' | 'invalid' | 'failed'; // 'failed': E-ME-07 failed or was rate-limited for a value that passed the local check
  invalidReason:
    'too_short' | 'too_long' | 'characters' | 'dots' | 'no_letter' | 'not_allowed' | null; // set when check is 'invalid'
  submit: {
    status: 'idle' | 'sending';
    errorCode: ErrorCode | null;
    changeAvailableAt: string | null;
  };
  offline: boolean; // the device has no connection: no submitting callback runs
  onChange: (value: string) => void; // the normalised value; drives the local check and the debounced E-ME-07
  onContinue: () => void; // E-ME-08 with the last checked value
  onBack: () => void;
};
