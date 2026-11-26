import type { ErrorCode } from '@citizenrun/shared';
import type { ComponentType } from 'react';

import type { AppleSignInButtonProps, GoogleSignInButtonProps } from '@/platform/auth'; // PC6C-18

export type SignInStage =
  | 'methods'
  | 'email'
  | 'code'
  | 'checkingAge'
  | 'ageGate'
  | 'state'
  | 'agreements'
  | 'aiConsent'
  | 'finishing';

type Bound<P> = ComponentType<
  Pick<P, Extract<keyof P, 'appearance' | 'testID' | 'accessibilityLabel'>>
>;

/** SCR-sign-in. */
export type SignInViewModel = {
  stage: SignInStage;
  signingUp: boolean; // true from 'checkingAge' on
  providersBusy: boolean;
  appleButton: Bound<AppleSignInButtonProps> | null;
  googleButton: Bound<GoogleSignInButtonProps> | null;
  notice: {
    code: ErrorCode | 'provider_unavailable' | 'generic'; // SCR-sign-in
    retryAfterSeconds: number | null;
  } | null;
  /** The public pages the methods stage names under its options. */
  legalLinks: { terms: string; privacyPolicy: string };
  email: {
    status: 'idle' | 'sending';
    errorCode: ErrorCode | null;
    retryAfterSeconds: number | null;
    onSubmit: (email: string) => void; // E-AUTH-01
  };
  code: {
    sentTo: string; // memory only
    status: 'idle' | 'checking' | 'wrong' | 'locked' | 'expired';
    resendAvailableAt: string; // EmailStartResult.resendAvailableAt
    resendStatus: 'idle' | 'sending' | 'limited';
    resendRetryAfterSeconds: number | null;
    onSubmit: (code: string) => void; // E-AUTH-02
    onResend: () => void; // E-AUTH-01
    onChangeEmail: () => void;
  } | null;
  ageGate: { onSubmit: (birth: { year: number; month: number }) => void; thisYear: number } | null;
  statePicker: { codes: readonly string[]; onSubmit: (code: string) => void } | null; // SCR-sign-in
  agreements: {
    links: { terms: string; contentPolicy: string; privacyPolicy: string };
    onAgree: () => void;
  } | null;
  aiConsent: { onAnswer: (allow: boolean) => void } | null;
  blocked: 'adultsOnly' | { stateUnavailable: string } | null; // SCR-sign-in
  offline: boolean;
  onChooseEmail: () => void;
  onBack: () => void;
};
