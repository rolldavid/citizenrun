import { STATE_CODES } from '@citizenrun/shared';

import { noop } from '@/lib/view-models/__fixtures__/common';

import { FIXTURE_APPLE_BUTTON, FIXTURE_GOOGLE_BUTTON } from './__fixtures__/provider-buttons';
import type { SignInViewModel } from './sign-in.types';

const CODE = {
  sentTo: 'fixture@example.test',
  status: 'idle',
  resendAvailableAt: '2027-01-15T12:00:30.000Z',
  resendStatus: 'idle',
  resendRetryAfterSeconds: null,
  onSubmit: noop,
  onResend: noop,
  onChangeEmail: noop,
} satisfies SignInViewModel['code'];

export const signInMethods = {
  stage: 'methods',
  signingUp: false,
  providersBusy: false,
  appleButton: FIXTURE_APPLE_BUTTON,
  googleButton: FIXTURE_GOOGLE_BUTTON,
  notice: null,
  legalLinks: {
    terms: 'https://example.test/terms',
    privacyPolicy: 'https://example.test/privacy',
  },
  email: { status: 'idle', errorCode: null, retryAfterSeconds: null, onSubmit: noop },
  code: null,
  statePicker: null,
  agreements: null,
  blocked: null,
  offline: false,
  onChooseEmail: noop,
  onBack: noop,
} satisfies SignInViewModel;

export const signInMethodsEmailOnly = {
  ...signInMethods,
  appleButton: null,
  googleButton: null,
} satisfies SignInViewModel;

export const signInMethodsBusy = {
  ...signInMethods,
  providersBusy: true,
} satisfies SignInViewModel;

export const signInMethodsNotice = {
  ...signInMethods,
  notice: { code: 'account_deleting', retryAfterSeconds: null },
} satisfies SignInViewModel;

export const signInEmail = {
  ...signInMethods,
  stage: 'email',
} satisfies SignInViewModel;

export const signInEmailSending = {
  ...signInEmail,
  email: { ...signInMethods.email, status: 'sending' },
} satisfies SignInViewModel;

export const signInEmailError = {
  ...signInEmail,
  email: { ...signInMethods.email, errorCode: 'email_undeliverable' },
} satisfies SignInViewModel;

export const signInCode = {
  ...signInMethods,
  stage: 'code',
  code: CODE,
} satisfies SignInViewModel;

export const signInCodeChecking = {
  ...signInCode,
  code: { ...CODE, status: 'checking' },
} satisfies SignInViewModel;

export const signInCodeWrong = {
  ...signInCode,
  code: { ...CODE, status: 'wrong' },
} satisfies SignInViewModel;

export const signInCodeLocked = {
  ...signInCode,
  code: { ...CODE, status: 'locked' },
} satisfies SignInViewModel;

export const signInCodeExpired = {
  ...signInCode,
  code: { ...CODE, status: 'expired' },
} satisfies SignInViewModel;

export const signInCodeResendLimited = {
  ...signInCode,
  code: { ...CODE, resendStatus: 'limited', resendRetryAfterSeconds: 900 },
} satisfies SignInViewModel;

export const signInCheckingAge = {
  ...signInMethods,
  stage: 'checkingAge',
  signingUp: true,
} satisfies SignInViewModel;

export const signInFinishing = {
  ...signInMethods,
  stage: 'finishing',
  signingUp: true,
} satisfies SignInViewModel;

export const signInState = {
  ...signInMethods,
  stage: 'state',
  signingUp: true,
  statePicker: { codes: STATE_CODES, onSubmit: noop },
} satisfies SignInViewModel;

export const signInAgreements = {
  ...signInMethods,
  stage: 'agreements',
  signingUp: true,
  agreements: {
    links: {
      terms: 'https://example.test/terms',
      privacyPolicy: 'https://example.test/privacy',
    },
    onAgree: noop,
  },
} satisfies SignInViewModel;

export const signInAdultsOnly = {
  ...signInMethods,
  blocked: 'adultsOnly',
} satisfies SignInViewModel;

export const signInStateUnavailable = {
  ...signInMethods,
  blocked: { stateUnavailable: 'VT' },
} satisfies SignInViewModel;

export const signInOffline = {
  ...signInEmail,
  offline: true,
} satisfies SignInViewModel;
